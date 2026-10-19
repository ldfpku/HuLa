//! 共享屏幕时的提示：被共享的显示器四周画一圈绿色边框，屏幕顶部显示“正在共享”提示条。
//! 和会议软件的惯例一样，让共享方一眼看出哪块画面正在被别人看到，避免露出敏感内容。
//!
//! - 边框窗口透明、置顶、鼠标穿透，只在共享整个显示器时出现；共享单个窗口时只显示提示条
//!   （WebView 拿不到被共享窗口的位置，边框无法跟随）。
//! - 两个窗口都设了内容保护，不会被录进共享出去的画面（Windows 10 2004 及以上、macOS）。
//! - 发起共享的通话窗口关闭时自动收起。

use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};

/// 边框窗口，对应前端路由 /shareBorder
const BORDER_LABEL: &str = "shareBorder";
/// 顶部提示条窗口，对应前端路由 /shareIndicator
const BAR_LABEL: &str = "shareIndicator";
/// 提示条上点“停止共享”时发给发起共享的通话窗口
const STOP_REQUEST_EVENT: &str = "screen-share-stop-request";
const BAR_WIDTH: f64 = 360.0;
const BAR_HEIGHT: f64 = 44.0;

/// 发起共享的通话窗口
static OWNER: Mutex<Option<String>> = Mutex::new(None);

/// 显示共享提示。surface 为 getDisplayMedia 的 displaySurface（monitor / window / browser），
/// width/height 为共享画面的像素尺寸，用来找出被共享的是哪块显示器
#[tauri::command]
pub fn screen_share_indicator_show(
    app: AppHandle,
    window: Window,
    surface: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    hide(&app);
    let owner = window.label().to_string();
    if let Ok(mut guard) = OWNER.lock() {
        *guard = Some(owner.clone());
    }

    let monitor = pick_monitor(&app, width, height);
    if surface == "monitor" {
        if let Some(monitor) = monitor.as_ref() {
            if let Err(e) = show_border(&app, monitor) {
                tracing::warn!("共享边框创建失败: {}", e);
            }
        }
    }
    if let Err(e) = show_bar(&app, monitor.as_ref(), &surface) {
        tracing::warn!("共享提示条创建失败: {}", e);
    }

    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) && is_owner(&owner) {
            hide(&close_app);
        }
    });
    Ok(())
}

/// 收起共享提示（停止共享、挂断时调用）
#[tauri::command]
pub fn screen_share_indicator_hide(app: AppHandle) {
    hide(&app);
}

/// 提示条上点了“停止共享”：通知发起共享的通话窗口去停止
#[tauri::command]
pub fn screen_share_indicator_stop(app: AppHandle) -> Result<(), String> {
    let owner = OWNER.lock().ok().and_then(|g| g.clone());
    match owner {
        Some(label) => app
            .emit_to(label.as_str(), STOP_REQUEST_EVENT, ())
            .map_err(|e| e.to_string()),
        None => {
            hide(&app);
            Ok(())
        }
    }
}

fn is_owner(label: &str) -> bool {
    OWNER
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|o| o == label))
        .unwrap_or(false)
}

fn hide(app: &AppHandle) {
    if let Ok(mut guard) = OWNER.lock() {
        *guard = None;
    }
    for label in [BORDER_LABEL, BAR_LABEL] {
        if let Some(existing) = app.get_webview_window(label) {
            let _ = existing.close();
        }
    }
}

/// 按共享画面的像素尺寸找显示器，找不到或有多块同尺寸时用主显示器
fn pick_monitor(app: &AppHandle, width: Option<u32>, height: Option<u32>) -> Option<Monitor> {
    if let (Some(w), Some(h), Ok(monitors)) = (width, height, app.available_monitors()) {
        let matched: Vec<Monitor> = monitors
            .into_iter()
            .filter(|m| {
                let size = m.size();
                (size.width == w && size.height == h) || (size.width == h && size.height == w)
            })
            .collect();
        if matched.len() == 1 {
            return matched.into_iter().next();
        }
    }
    app.primary_monitor().ok().flatten()
}

fn show_border(app: &AppHandle, monitor: &Monitor) -> tauri::Result<()> {
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let pos = monitor.position().to_logical::<f64>(scale);
    let border =
        WebviewWindowBuilder::new(app, BORDER_LABEL, WebviewUrl::App("shareBorder".into()))
            .title("正在共享屏幕")
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .closable(false)
            .minimizable(false)
            .maximizable(false)
            .content_protected(true)
            .build()?;
    border.set_ignore_cursor_events(true)?;
    Ok(())
}

fn show_bar(app: &AppHandle, monitor: Option<&Monitor>, surface: &str) -> tauri::Result<()> {
    let surface: String = url::form_urlencoded::byte_serialize(surface.as_bytes()).collect();
    let mut builder = WebviewWindowBuilder::new(
        app,
        BAR_LABEL,
        WebviewUrl::App(format!("shareIndicator?surface={surface}").into()),
    )
    .title("正在共享屏幕")
    .inner_size(BAR_WIDTH, BAR_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .closable(false)
    .minimizable(false)
    .maximizable(false)
    .content_protected(true)
    .shadow(true);
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let pos = monitor.position().to_logical::<f64>(scale);
        builder = builder.position(pos.x + (size.width - BAR_WIDTH) / 2.0, pos.y + 8.0);
    } else {
        builder = builder.center();
    }
    builder.build()?;
    Ok(())
}

/// 共享提示条存在时，远程控制提示条要往下让开
pub fn bar_visible(app: &AppHandle) -> bool {
    app.get_webview_window(BAR_LABEL).is_some()
}

/// 远程控制提示条让开共享提示条后的纵向偏移
pub const BAR_OFFSET: f64 = BAR_HEIGHT + 16.0;
