//! 远程控制的被控端：对方在一对一通话里请求控制本机时，先弹系统确认框，
//! 本人同意后才开始把对方发来的鼠标键盘事件注入系统，并在屏幕顶部显示常驻提示条。
//! 只操作主显示器；坐标由前端换算成主屏画面里 0 到 1 的比例。
//!
//! 安全上的约束都在这里兜底，不依赖前端：
//! - 没有经确认框同意的会话时，输入一律拒绝；
//! - 发起会话的通话窗口关闭、提示条上点“停止控制”或前端调用停止，都会结束会话并松开所有按下的键；
//! - 坐标限制在主屏范围内，一次输入的文字长度有上限。

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// 屏幕顶部提示条的窗口标签，对应前端路由 /rcIndicator
const INDICATOR_LABEL: &str = "rcIndicator";
/// 会话结束时发给所有窗口的事件，通话窗口据此通知对方
const STOPPED_EVENT: &str = "remote-control-stopped";
/// 单次文字输入的长度上限（字符）
const MAX_TEXT_CHARS: usize = 2000;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteInput {
    /// 鼠标移动，x/y 为主屏画面里 0 到 1 的比例
    Move { x: f64, y: f64 },
    /// 鼠标按键：left / right / middle
    Button {
        button: String,
        down: bool,
        x: f64,
        y: f64,
    },
    /// 滚轮，单位为“行”，正数向下/向右
    Wheel { dx: i32, dy: i32 },
    /// 按键，key 为前端统一过的键名（Enter、ArrowLeft、F5、单个字符等）
    Key { key: String, down: bool },
    /// 直接输入文字（中文等输入法上屏的内容）
    Text { text: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlGrant {
    pub granted: bool,
    /// 主屏尺寸（系统坐标单位），用来让控制方判断共享的是不是主屏
    pub width: i32,
    pub height: i32,
}

enum Job {
    Input(RemoteInput),
    Stop,
}

struct Session {
    tx: Sender<Job>,
    /// 发起会话的通话窗口
    window_label: String,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
/// 确认框弹出期间不再接受新的请求
static ASKING: Mutex<bool> = Mutex::new(false);

/// 被控方确认：弹出系统确认框，同意后开始会话并显示提示条
#[tauri::command]
pub async fn remote_control_request(
    app: AppHandle,
    window: Window,
    peer_name: String,
) -> Result<RemoteControlGrant, String> {
    {
        let mut asking = ASKING.lock().map_err(|e| e.to_string())?;
        if *asking {
            return Err("正在等待确认上一个控制请求".into());
        }
        *asking = true;
    }
    let peer = sanitize_name(&peer_name);
    let dialog_app = app.clone();
    let dialog_peer = peer.clone();
    let agreed = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .message(format!(
                "{dialog_peer} 请求远程控制你的电脑。\n\n同意后对方可以操作你的鼠标和键盘，并看到你的整个屏幕。你可以随时点屏幕顶部的“停止控制”结束，挂断通话也会自动结束。"
            ))
            .title("远程控制请求")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "同意".into(),
                "拒绝".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);
    if let Ok(mut asking) = ASKING.lock() {
        *asking = false;
    }
    if !agreed {
        return Ok(RemoteControlGrant {
            granted: false,
            width: 0,
            height: 0,
        });
    }

    // 已有会话（例如重复请求）先结束，保证同一时间只有一个
    stop_session(&app, "replaced");

    let (tx, rx) = mpsc::channel::<Job>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(i32, i32), String>>();
    thread::Builder::new()
        .name("remote-control-input".into())
        .spawn(move || input_thread(rx, ready_tx))
        .map_err(|e| format!("无法启动远程控制: {e}"))?;
    let (width, height) = ready_rx
        .recv()
        .map_err(|_| "无法启动远程控制".to_string())??;

    let window_label = window.label().to_string();
    {
        let mut guard = SESSION.lock().map_err(|e| e.to_string())?;
        *guard = Some(Session {
            tx,
            window_label: window_label.clone(),
        });
    }

    // 通话窗口关闭（挂断、崩溃）时结束会话
    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let owned = SESSION
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(|s| s.window_label == window_label))
                .unwrap_or(false);
            if owned {
                stop_session(&close_app, "window-closed");
            }
        }
    });

    if let Err(e) = show_indicator(&app, &peer) {
        tracing::warn!("远程控制提示条创建失败: {}", e);
    }
    tracing::info!("远程控制已开始，主屏 {}x{}", width, height);
    Ok(RemoteControlGrant {
        granted: true,
        width,
        height,
    })
}

/// 注入一条输入；没有已同意的会话时拒绝
#[tauri::command]
pub fn remote_control_input(input: RemoteInput) -> Result<(), String> {
    let guard = SESSION.lock().map_err(|e| e.to_string())?;
    let Some(session) = guard.as_ref() else {
        return Err("远程控制未授权".into());
    };
    session
        .tx
        .send(Job::Input(input))
        .map_err(|_| "远程控制已结束".to_string())
}

/// 结束远程控制（提示条按钮、通话窗口、挂断都会调用）
#[tauri::command]
pub fn remote_control_stop(app: AppHandle) -> Result<bool, String> {
    Ok(stop_session(&app, "stopped"))
}

/// 当前是否有远程控制会话
#[tauri::command]
pub fn remote_control_active() -> bool {
    SESSION.lock().map(|g| g.is_some()).unwrap_or(false)
}

fn stop_session(app: &AppHandle, reason: &str) -> bool {
    let session = SESSION.lock().ok().and_then(|mut g| g.take());
    let Some(session) = session else {
        return false;
    };
    let _ = session.tx.send(Job::Stop);
    if let Some(indicator) = app.get_webview_window(INDICATOR_LABEL) {
        let _ = indicator.close();
    }
    if let Err(e) = app.emit(STOPPED_EVENT, reason) {
        tracing::warn!("远程控制结束事件发送失败: {}", e);
    }
    tracing::info!("远程控制已结束: {}", reason);
    true
}

fn sanitize_name(name: &str) -> String {
    let trimmed: String = name.chars().filter(|c| !c.is_control()).take(40).collect();
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        "对方".into()
    } else {
        trimmed.to_string()
    }
}

/// 在主屏顶部居中显示常驻提示条（置顶、无边框、不进任务栏、不抢焦点）
fn show_indicator(app: &AppHandle, peer: &str) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(INDICATOR_LABEL) {
        let _ = existing.close();
    }
    let name: String = url::form_urlencoded::byte_serialize(peer.as_bytes()).collect();
    let width = 420.0;
    let height = 48.0;
    let mut builder = WebviewWindowBuilder::new(
        app,
        INDICATOR_LABEL,
        WebviewUrl::App(format!("rcIndicator?name={name}").into()),
    )
    .title("远程控制中")
    .inner_size(width, height)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .closable(false)
    .minimizable(false)
    .maximizable(false)
    .shadow(true);
    if let Some(monitor) = app.primary_monitor()? {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let pos = monitor.position().to_logical::<f64>(scale);
        // 共享屏幕的提示条也在顶部居中，有它时往下让开
        let offset = if super::share_indicator::bar_visible(app) {
            super::share_indicator::BAR_OFFSET
        } else {
            0.0
        };
        builder = builder.position(pos.x + (size.width - width) / 2.0, pos.y + 8.0 + offset);
    } else {
        builder = builder.center();
    }
    builder.build()?;
    Ok(())
}

fn input_thread(rx: Receiver<Job>, ready: Sender<Result<(i32, i32), String>>) {
    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(enigo) => enigo,
        Err(e) => {
            let hint = if cfg!(target_os = "macos") {
                "请在“系统设置 > 隐私与安全性 > 辅助功能”里允许本应用后重试"
            } else {
                "系统不允许模拟输入"
            };
            let _ = ready.send(Err(format!("无法控制鼠标键盘（{e}），{hint}")));
            return;
        }
    };
    let (width, height) = match enigo.main_display() {
        Ok(size) => size,
        Err(e) => {
            let _ = ready.send(Err(format!("无法读取屏幕尺寸: {e}")));
            return;
        }
    };
    if ready.send(Ok((width, height))).is_err() {
        return;
    }

    let mut held_keys: HashSet<String> = HashSet::new();
    let mut held_buttons: HashSet<&'static str> = HashSet::new();
    // 通道断开（会话被丢弃）与收到 Stop 一样处理
    while let Ok(job) = rx.recv() {
        let input = match job {
            Job::Stop => break,
            Job::Input(input) => input,
        };
        if let Err(e) = apply_input(
            &mut enigo,
            input,
            width,
            height,
            &mut held_keys,
            &mut held_buttons,
        ) {
            tracing::debug!("远程控制输入失败: {}", e);
        }
    }

    // 结束时松开对方按住的键和鼠标键，避免本机卡在按下状态
    for key in held_keys.drain() {
        if let Some(k) = map_key(&key) {
            let _ = enigo.key(k, Direction::Release);
        }
    }
    for button in held_buttons.drain() {
        if let Some(b) = map_button(button) {
            let _ = enigo.button(b, Direction::Release);
        }
    }
}

fn to_screen(v: f64, size: i32) -> i32 {
    let v = if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.0
    };
    ((size - 1).max(0) as f64 * v).round() as i32
}

fn apply_input(
    enigo: &mut Enigo,
    input: RemoteInput,
    width: i32,
    height: i32,
    held_keys: &mut HashSet<String>,
    held_buttons: &mut HashSet<&'static str>,
) -> Result<(), String> {
    match input {
        RemoteInput::Move { x, y } => enigo
            .move_mouse(to_screen(x, width), to_screen(y, height), Coordinate::Abs)
            .map_err(|e| e.to_string()),
        RemoteInput::Button { button, down, x, y } => {
            let name = match button.as_str() {
                "left" => "left",
                "right" => "right",
                "middle" => "middle",
                _ => return Err(format!("未知鼠标键: {button}")),
            };
            let b = map_button(name).ok_or("未知鼠标键")?;
            enigo
                .move_mouse(to_screen(x, width), to_screen(y, height), Coordinate::Abs)
                .map_err(|e| e.to_string())?;
            if down {
                held_buttons.insert(name);
                enigo.button(b, Direction::Press).map_err(|e| e.to_string())
            } else {
                held_buttons.remove(name);
                enigo
                    .button(b, Direction::Release)
                    .map_err(|e| e.to_string())
            }
        }
        RemoteInput::Wheel { dx, dy } => {
            if dy != 0 {
                enigo
                    .scroll(dy.clamp(-20, 20), Axis::Vertical)
                    .map_err(|e| e.to_string())?;
            }
            if dx != 0 {
                enigo
                    .scroll(dx.clamp(-20, 20), Axis::Horizontal)
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        RemoteInput::Key { key, down } => {
            let k = map_key(&key).ok_or_else(|| format!("不支持的按键: {key}"))?;
            if down {
                held_keys.insert(key);
                enigo.key(k, Direction::Press).map_err(|e| e.to_string())
            } else {
                held_keys.remove(&key);
                enigo.key(k, Direction::Release).map_err(|e| e.to_string())
            }
        }
        RemoteInput::Text { text } => {
            let text: String = text
                .chars()
                .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
                .take(MAX_TEXT_CHARS)
                .collect();
            if text.is_empty() {
                return Ok(());
            }
            enigo.text(&text).map_err(|e| e.to_string())
        }
    }
}

fn map_button(name: &str) -> Option<Button> {
    match name {
        "left" => Some(Button::Left),
        "right" => Some(Button::Right),
        "middle" => Some(Button::Middle),
        _ => None,
    }
}

/// 前端键名到系统按键；单个字符按当前键盘布局找对应的键
fn map_key(key: &str) -> Option<Key> {
    let named = match key {
        "Enter" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Space" => Key::Space,
        "Delete" => Key::Delete,
        #[cfg(not(target_os = "macos"))]
        "Insert" => Key::Insert,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Shift" => Key::Shift,
        "Control" => Key::Control,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        "CapsLock" => Key::CapsLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        _ => {
            let mut chars = key.chars();
            let c = chars.next()?;
            if chars.next().is_some() || c.is_control() {
                return None;
            }
            return Some(Key::Unicode(c));
        }
    };
    Some(named)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_ratio_into_screen() {
        assert_eq!(to_screen(0.0, 1920), 0);
        assert_eq!(to_screen(1.0, 1920), 1919);
        assert_eq!(to_screen(0.5, 1081), 540);
        assert_eq!(to_screen(-3.0, 1920), 0);
        assert_eq!(to_screen(9.0, 1920), 1919);
        assert_eq!(to_screen(f64::NAN, 1920), 0);
    }

    #[test]
    fn maps_keys() {
        assert!(matches!(map_key("Enter"), Some(Key::Return)));
        assert!(matches!(map_key("a"), Some(Key::Unicode('a'))));
        assert!(matches!(map_key("、"), Some(Key::Unicode('、'))));
        assert!(map_key("NotAKey").is_none());
        assert!(map_key("").is_none());
        assert!(map_key("\u{7}").is_none());
    }

    #[test]
    fn parses_inputs() {
        let move_input: RemoteInput =
            serde_json::from_str(r#"{"kind":"move","x":0.25,"y":0.75}"#).unwrap();
        assert!(matches!(move_input, RemoteInput::Move { .. }));
        let key_input: RemoteInput =
            serde_json::from_str(r#"{"kind":"key","key":"Control","down":true}"#).unwrap();
        assert!(matches!(key_input, RemoteInput::Key { down: true, .. }));
        assert!(serde_json::from_str::<RemoteInput>(r#"{"kind":"exec","cmd":"x"}"#).is_err());
    }

    #[test]
    fn cleans_peer_name() {
        assert_eq!(sanitize_name("  张三\n "), "张三");
        assert_eq!(sanitize_name(""), "对方");
    }
}
