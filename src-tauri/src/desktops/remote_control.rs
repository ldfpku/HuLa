//! 远程控制的被控端：对方在一对一通话里请求控制本机时，通话窗口显示确认卡片，本人点“同意并共享屏幕”
//! 并共享了整个主屏后，通话窗口才调用 [`remote_control_request`] 开始会话、在屏幕顶部显示常驻提示条，
//! 核对是主屏后再调用 [`remote_control_activate`]，此后才把对方发来的鼠标键盘事件注入系统。
//! 只操作主显示器；坐标由前端换算成主屏画面里 0 到 1 的比例。
//!
//! “本人是否同意”由通话窗口判断：确认卡片只认本人真实的点击（`isTrusted`），并且必须经过系统的屏幕选择窗口
//! 共享了整个屏幕；这里不再弹系统确认框，所以 Rust 侧不独立核实同意。同意之前对方无法注入任何输入，
//! 因为没有会话。会话开始之后的约束都在这里兜底，不依赖前端：
//! - 没有会话、或会话还没放行（[`remote_control_activate`]）时，输入一律拒绝；
//! - 发起会话的通话窗口关闭、提示条上点“停止控制”或前端调用停止，都会结束会话并松开所有按下的键；
//! - 通话窗口要持续发心跳，卡住或没响应超过 [`HEARTBEAT_TIMEOUT`] 自动结束；会话开始后迟迟没放行输入也会结束；
//! - 本机按住 Esc 一秒立即结束（Windows，只认本机键盘，对方发来的按键不算），
//!   即使应用界面没有响应，也会停止注入并收起置顶的提示窗口；
//! - 卡片出现到开始共享之前（[`remote_control_prepare`]），本机短按 Esc 即拒绝请求，不必先共享；
//! - 坐标限制在主屏范围内，一次输入的文字长度有上限。
//!
//! 输入、心跳、停止都是异步命令，不占主线程：主线程忙或卡住时注入和停止仍能进行。

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

/// 屏幕顶部提示条的窗口标签，对应前端路由 /rcIndicator
const INDICATOR_LABEL: &str = "rcIndicator";
/// 会话结束时发给所有窗口的事件，通话窗口据此通知对方
const STOPPED_EVENT: &str = "remote-control-stopped";
/// 单次文字输入的长度上限（字符）
const MAX_TEXT_CHARS: usize = 2000;
/// 通话窗口多久没发心跳就结束会话（前端每 2 秒发一次）
pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(8);
/// 会话开始（本人已共享）后多久还没放行输入就结束会话。正常几秒内就会放行，这只是通话窗口出错时的兜底；
/// 等本人同意的 60 秒由通话窗口计时（双方一致），不在这里
const ACTIVATE_TIMEOUT: Duration = Duration::from_secs(30);
/// 本机按住 Esc 多久结束控制
#[cfg(target_os = "windows")]
const ESCAPE_HOLD_MS: u32 = 1000;
/// 等待本人同意的阶段最长多久（前端 60 秒就会自己取消，这里只是兜底收起 Esc 监听）
const PREPARE_TIMEOUT: Duration = Duration::from_secs(120);
/// 结束原因：本机按住 Esc。前端收到后连同屏幕共享一起停掉
#[cfg(target_os = "windows")]
const REASON_ESCAPE: &str = "escape";

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
    id: u64,
    tx: Sender<Job>,
    /// 发起会话的通话窗口
    window_label: String,
    /// 通话窗口已确认整屏共享就绪，可以注入输入
    active: bool,
    started: Instant,
    last_beat: Instant,
}

/// 会话检查的结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Keep,
    /// 通话窗口没有心跳
    Silent,
    /// 会话开始后一直没放行输入
    NotShared,
}

impl Session {
    fn verdict(&self, now: Instant) -> Verdict {
        if now.duration_since(self.last_beat) > HEARTBEAT_TIMEOUT {
            Verdict::Silent
        } else if !self.active && now.duration_since(self.started) > ACTIVATE_TIMEOUT {
            Verdict::NotShared
        } else {
            Verdict::Keep
        }
    }
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);
/// 正在等待本人同意的请求编号（0 表示没有）
static PENDING: AtomicU64 = AtomicU64::new(0);

/// 对方请求控制、通话窗口显示确认卡片时调用：开始监听本机 Esc，短按即拒绝。
/// 拒绝时发出 [`STOPPED_EVENT`]（"escape"），通话窗口据此收起卡片并通知对方。
#[tauri::command]
pub async fn remote_control_prepare(app: AppHandle) -> Result<(), String> {
    let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    PENDING.store(id, Ordering::Relaxed);
    #[cfg(target_os = "windows")]
    {
        escape::start(0);
        tracing::info!("远程控制等待同意：本机 Esc 监听已开（短按即拒绝）");
    }
    thread::Builder::new()
        .name("remote-control-pending".into())
        .spawn(move || pending_watch(app, id))
        .map_err(|e| format!("无法启动远程控制: {e}"))?;
    Ok(())
}

/// 等待同意阶段：本机按 Esc 就拒绝；本人同意（开始会话）、拒绝或超时后退出
fn pending_watch(app: AppHandle, id: u64) {
    // 只有 Windows 监听 Esc；其他系统靠通话窗口里的 Esc 按键
    #[cfg(not(target_os = "windows"))]
    drop(app);
    let started = Instant::now();
    loop {
        thread::sleep(Duration::from_millis(100));
        if PENDING.load(Ordering::Relaxed) != id {
            return;
        }
        #[cfg(target_os = "windows")]
        log_escape_presses();
        #[cfg(target_os = "windows")]
        if escape::take_triggered() {
            if clear_pending(id) {
                tracing::warn!("远程控制等待同意：本机按 Esc，拒绝请求");
                if let Err(e) = app.emit(STOPPED_EVENT, REASON_ESCAPE) {
                    tracing::warn!("远程控制结束事件发送失败: {}", e);
                }
            }
            return;
        }
        if started.elapsed() > PREPARE_TIMEOUT {
            if clear_pending(id) {
                tracing::warn!("远程控制等待同意超时，收起 Esc 监听");
            }
            return;
        }
    }
}

/// 记下钩子收到的本机 Esc（排查“按了没反应”时看钩子是否收到按键）
#[cfg(target_os = "windows")]
fn log_escape_presses() {
    let (down, up) = escape::take_presses();
    if down > 0 || up > 0 {
        tracing::info!("远程控制：本机 Esc 按下 {} 次、松开 {} 次", down, up);
    }
}

/// 结束指定的等待阶段（已被同意、拒绝或新请求替换时返回 false）
fn clear_pending(id: u64) -> bool {
    let cleared = PENDING
        .compare_exchange(id, 0, Ordering::Relaxed, Ordering::Relaxed)
        .is_ok();
    #[cfg(target_os = "windows")]
    if cleared {
        escape::stop();
    }
    cleared
}

/// 结束任何等待阶段（同意或停止时）
fn clear_any_pending() -> bool {
    let id = PENDING.load(Ordering::Relaxed);
    id != 0 && clear_pending(id)
}

/// 本人已在通话窗口同意并共享了整个屏幕：开始会话（输入仍待放行）并显示提示条，返回主屏尺寸
#[tauri::command]
pub async fn remote_control_request(
    app: AppHandle,
    window: Window,
    peer_name: String,
) -> Result<RemoteControlGrant, String> {
    let peer = sanitize_name(&peer_name);

    // 已有会话（例如重复请求）先结束，保证同一时间只有一个
    clear_any_pending();
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
    let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    {
        let mut guard = SESSION.lock().map_err(|e| e.to_string())?;
        let now = Instant::now();
        *guard = Some(Session {
            id,
            tx,
            window_label: window_label.clone(),
            active: false,
            started: now,
            last_beat: now,
        });
    }
    #[cfg(target_os = "windows")]
    escape::start(ESCAPE_HOLD_MS);
    let watch_app = app.clone();
    let _ = thread::Builder::new()
        .name("remote-control-watchdog".into())
        .spawn(move || watchdog(watch_app, id));

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

    match show_indicator(&app, &peer) {
        Ok(()) => tracing::info!("远程控制提示条已创建"),
        Err(e) => tracing::warn!("远程控制提示条创建失败: {}", e),
    }
    tracing::info!("远程控制已开始，主屏 {}x{}", width, height);
    Ok(RemoteControlGrant {
        granted: true,
        width,
        height,
    })
}

/// 通话窗口确认整屏共享已就绪、核对过是主屏，此后才注入输入
#[tauri::command]
pub async fn remote_control_activate() -> Result<(), String> {
    let mut guard = SESSION.lock().map_err(|e| e.to_string())?;
    let Some(session) = guard.as_mut() else {
        return Err("远程控制已结束".into());
    };
    session.active = true;
    session.last_beat = Instant::now();
    tracing::info!("远程控制已放行输入");
    Ok(())
}

/// 通话窗口的心跳；返回会话是否还在
#[tauri::command]
pub async fn remote_control_heartbeat() -> bool {
    SESSION
        .lock()
        .ok()
        .and_then(|mut g| {
            g.as_mut().map(|s| {
                s.last_beat = Instant::now();
            })
        })
        .is_some()
}

/// 注入一条输入；没有已同意并已开始共享的会话时拒绝
#[tauri::command]
pub async fn remote_control_input(input: RemoteInput) -> Result<(), String> {
    let guard = SESSION.lock().map_err(|e| e.to_string())?;
    let Some(session) = guard.as_ref() else {
        return Err("远程控制未授权".into());
    };
    if !session.active {
        return Err("远程控制尚未开始".into());
    }
    session
        .tx
        .send(Job::Input(input))
        .map_err(|_| "远程控制已结束".to_string())
}

/// 结束远程控制（提示条按钮、通话窗口、挂断都会调用）
#[tauri::command]
pub async fn remote_control_stop(app: AppHandle) -> Result<bool, String> {
    let was_pending = clear_any_pending();
    Ok(stop_session(&app, "stopped") || was_pending)
}

/// 当前是否有远程控制会话
#[tauri::command]
pub async fn remote_control_active() -> bool {
    SESSION.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// 每 200 毫秒检查一次会话：本机按住 Esc、心跳超时、迟迟没放行输入都结束会话
fn watchdog(app: AppHandle, id: u64) {
    loop {
        thread::sleep(Duration::from_millis(200));
        let verdict = {
            let Ok(guard) = SESSION.lock() else { return };
            match guard.as_ref() {
                Some(session) if session.id == id => session.verdict(Instant::now()),
                // 会话已结束或已被新的会话替换
                _ => return,
            }
        };
        #[cfg(target_os = "windows")]
        log_escape_presses();
        #[cfg(target_os = "windows")]
        if escape::take_triggered() {
            tracing::warn!("本机按住 Esc，结束远程控制");
            // 界面可能已无响应：先直接收起置顶的提示窗口，保证本机能点到别的东西
            escape::hide_overlay_windows();
            exit_if_ui_hung(&app);
            stop_session_if(&app, id, REASON_ESCAPE);
            super::share_indicator::hide_overlays(&app);
            return;
        }
        let reason = match verdict {
            Verdict::Keep => continue,
            Verdict::Silent => "no-heartbeat",
            Verdict::NotShared => "not-shared",
        };
        tracing::warn!("远程控制自动结束: {}", reason);
        #[cfg(target_os = "windows")]
        if verdict == Verdict::Silent {
            // 通话窗口没响应，界面可能卡住：直接收起置顶的提示窗口
            escape::hide_overlay_windows();
        }
        stop_session_if(&app, id, reason);
        return;
    }
}

/// 本机按住 Esc 后，主线程 3 秒内没响应说明界面已卡死：强制退出应用，免得只能重启电脑
#[cfg(target_os = "windows")]
fn exit_if_ui_hung(app: &AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    if app
        .run_on_main_thread(move || {
            let _ = tx.send(());
        })
        .is_err()
    {
        return;
    }
    let _ = thread::Builder::new()
        .name("remote-control-ui-probe".into())
        .spawn(move || {
            if rx.recv_timeout(Duration::from_secs(3)).is_err() {
                tracing::error!("远程控制紧急退出：界面 3 秒无响应，强制退出应用");
                std::process::exit(1);
            }
        });
}

/// 只结束指定的会话（检查期间可能已换成新的会话）
fn stop_session_if(app: &AppHandle, id: u64, reason: &str) -> bool {
    let current = SESSION
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.id))
        .unwrap_or(0);
    current == id && stop_session(app, reason)
}

fn stop_session(app: &AppHandle, reason: &str) -> bool {
    let session = SESSION.lock().ok().and_then(|mut g| g.take());
    let Some(session) = session else {
        return false;
    };
    let _ = session.tx.send(Job::Stop);
    #[cfg(target_os = "windows")]
    escape::stop();
    tracing::info!(
        "远程控制结束中: {}（已放行输入: {}）",
        reason,
        session.active
    );
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
    let width = 500.0;
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

/// 本机的紧急退出：按住 Esc 一秒结束控制。
/// 用低级键盘钩子在独立线程里监听，不依赖应用界面和主线程；钩子只观察、不拦截按键，
/// 并跳过注入的按键（对方发来的 Esc 不算）。
#[cfg(target_os = "windows")]
mod escape {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::thread;

    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, EnumWindows, GetMessageW, GetWindowThreadProcessId, InternalGetWindowText,
        KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, PostThreadMessageW, SW_HIDE, SetWindowsHookExW,
        ShowWindowAsync, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };
    use windows::core::BOOL;

    const VK_ESCAPE: u32 = 0x1B;
    /// 紧急退出时直接隐藏的置顶窗口（按窗口标题找，只找本进程的）
    const OVERLAY_TITLES: [&str; 2] = ["远程控制中", "正在共享屏幕"];

    static TRIGGERED: AtomicBool = AtomicBool::new(false);
    /// 要按住多久才算（毫秒）；0 表示按下即算
    static HOLD_MS: AtomicU32 = AtomicU32::new(super::ESCAPE_HOLD_MS);
    /// 本机 Esc 按下的时刻（键盘事件时间戳，0 表示没按着）
    static DOWN_AT: AtomicU32 = AtomicU32::new(0);
    static HOOK_THREAD: Mutex<Option<u32>> = Mutex::new(None);
    /// 监听的代数，见 [`start`]
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    /// 本机按下、松开 Esc 的次数（不含按住时的自动重复），只用于日志
    static PRESSES: AtomicU32 = AtomicU32::new(0);
    static RELEASES: AtomicU32 = AtomicU32::new(0);

    /// 按下时刻和当前时刻（毫秒时间戳，会回绕）判断是否按满 hold 毫秒
    pub(super) fn held_long_enough(down_at: u32, now: u32, hold: u32) -> bool {
        down_at != 0 && now.wrapping_sub(down_at) >= hold
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && lparam.0 != 0 {
            let kb = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let injected = (kb.flags.0 & LLKHF_INJECTED.0) != 0;
            if kb.vkCode == VK_ESCAPE && !injected {
                match wparam.0 as u32 {
                    WM_KEYDOWN | WM_SYSKEYDOWN => {
                        let hold = HOLD_MS.load(Ordering::Relaxed);
                        let mut down_at = DOWN_AT.load(Ordering::Relaxed);
                        if down_at == 0 {
                            down_at = kb.time.max(1);
                            DOWN_AT.store(down_at, Ordering::Relaxed);
                            PRESSES.fetch_add(1, Ordering::Relaxed);
                        }
                        if held_long_enough(down_at, kb.time, hold) {
                            TRIGGERED.store(true, Ordering::Relaxed);
                        }
                    }
                    WM_KEYUP | WM_SYSKEYUP => {
                        DOWN_AT.store(0, Ordering::Relaxed);
                        RELEASES.fetch_add(1, Ordering::Relaxed);
                    }
                    _ => {}
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// 开始监听；hold 为要按住的毫秒数，0 表示按下即算。
    /// 先结束上一代监听；每一代有自己的编号，钩子线程登记时编号已变（期间被停止或换代）就自行退出，
    /// 停止时只会结束当前登记的那一代，不会误杀刚启动的新监听。
    pub fn start(hold: u32) {
        stop();
        HOLD_MS.store(hold, Ordering::Relaxed);
        TRIGGERED.store(false, Ordering::Relaxed);
        PRESSES.store(0, Ordering::Relaxed);
        RELEASES.store(0, Ordering::Relaxed);
        DOWN_AT.store(0, Ordering::Relaxed);
        let generation = GENERATION.load(Ordering::Relaxed);
        let spawned = thread::Builder::new()
            .name("remote-control-escape".into())
            .spawn(move || unsafe {
                let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), None, 0) {
                    Ok(hook) => hook,
                    Err(e) => {
                        tracing::warn!("远程控制 Esc 退出监听失败: {}", e);
                        return;
                    }
                };
                let thread_id = GetCurrentThreadId();
                {
                    let Ok(mut guard) = HOOK_THREAD.lock() else {
                        let _ = UnhookWindowsHookEx(hook);
                        return;
                    };
                    if GENERATION.load(Ordering::Relaxed) != generation {
                        // 还没登记就已被停止或换代
                        let _ = UnhookWindowsHookEx(hook);
                        return;
                    }
                    *guard = Some(thread_id);
                }
                tracing::info!(
                    "远程控制 Esc 监听已安装（第 {} 代，线程 {}，按住 {} 毫秒）",
                    generation,
                    thread_id,
                    hold
                );
                // 低级钩子需要本线程有消息循环
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
                let _ = UnhookWindowsHookEx(hook);
                tracing::info!("远程控制 Esc 监听已卸载（第 {} 代）", generation);
            });
        if let Err(e) = spawned {
            tracing::warn!("远程控制 Esc 退出监听启动失败: {}", e);
        }
    }

    pub fn stop() {
        let thread_id = {
            let Ok(mut guard) = HOOK_THREAD.lock() else {
                return;
            };
            // 换代放在锁里：正在启动、还没登记的钩子线程看到编号变了会自己退出
            GENERATION.fetch_add(1, Ordering::Relaxed);
            guard.take()
        };
        if let Some(thread_id) = thread_id {
            unsafe {
                let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
    }

    /// 自上次查询以来本机按下、松开 Esc 的次数（只用于日志，确认钩子收得到按键）
    pub fn take_presses() -> (u32, u32) {
        (
            PRESSES.swap(0, Ordering::Relaxed),
            RELEASES.swap(0, Ordering::Relaxed),
        )
    }

    pub fn take_triggered() -> bool {
        TRIGGERED.swap(false, Ordering::Relaxed)
    }

    unsafe extern "system" fn hide_if_overlay(hwnd: HWND, _: LPARAM) -> BOOL {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid != unsafe { GetCurrentProcessId() } {
            return true.into();
        }
        let mut buf = [0u16; 64];
        let len = unsafe { InternalGetWindowText(hwnd, &mut buf) };
        let title = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
        if OVERLAY_TITLES.contains(&title.as_str()) {
            // 异步隐藏：窗口所在线程卡住时也不会等它
            let _ = unsafe { ShowWindowAsync(hwnd, SW_HIDE) };
        }
        true.into()
    }

    /// 直接隐藏本进程的提示条和共享边框，不经过主线程
    pub fn hide_overlay_windows() {
        unsafe {
            let _ = EnumWindows(Some(hide_if_overlay), LPARAM(0));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(active: bool, started_ago: Duration, beat_ago: Duration) -> (Session, Instant) {
        let now = Instant::now() + Duration::from_secs(3600);
        let (tx, _rx) = mpsc::channel();
        (
            Session {
                id: 1,
                tx,
                window_label: "rtcCall".into(),
                active,
                started: now - started_ago,
                last_beat: now - beat_ago,
            },
            now,
        )
    }

    #[test]
    fn watchdog_verdicts() {
        let (s, now) = session(false, Duration::from_secs(5), Duration::from_secs(1));
        assert_eq!(s.verdict(now), Verdict::Keep);
        let (s, now) = session(true, Duration::from_secs(600), Duration::from_secs(2));
        assert_eq!(s.verdict(now), Verdict::Keep);
        let (s, now) = session(true, Duration::from_secs(600), Duration::from_secs(9));
        assert_eq!(s.verdict(now), Verdict::Silent);
        let (s, now) = session(false, Duration::from_secs(31), Duration::from_secs(1));
        assert_eq!(s.verdict(now), Verdict::NotShared);
    }

    #[test]
    fn input_needs_active_session() {
        let (tx, rx) = mpsc::channel();
        let now = Instant::now();
        *SESSION.lock().unwrap() = Some(Session {
            id: 7,
            tx,
            window_label: "rtcCall".into(),
            active: false,
            started: now,
            last_beat: now,
        });
        let input = || RemoteInput::Move { x: 0.5, y: 0.5 };
        let err = tauri::async_runtime::block_on(remote_control_input(input())).unwrap_err();
        assert!(err.contains("尚未开始"));
        assert!(rx.try_recv().is_err());
        tauri::async_runtime::block_on(remote_control_activate()).unwrap();
        tauri::async_runtime::block_on(remote_control_input(input())).unwrap();
        assert!(matches!(rx.try_recv(), Ok(Job::Input(_))));
        *SESSION.lock().unwrap() = None;
        assert!(tauri::async_runtime::block_on(remote_control_input(input())).is_err());
        assert!(!tauri::async_runtime::block_on(remote_control_heartbeat()));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn escape_hold() {
        assert!(!escape::held_long_enough(0, 5000, ESCAPE_HOLD_MS));
        assert!(!escape::held_long_enough(1000, 1999, ESCAPE_HOLD_MS));
        assert!(escape::held_long_enough(1000, 2000, ESCAPE_HOLD_MS));
        assert!(escape::held_long_enough(
            u32::MAX - 100,
            900,
            ESCAPE_HOLD_MS
        ));
        // 等待同意阶段：按下即算
        assert!(escape::held_long_enough(1000, 1000, 0));
    }

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
