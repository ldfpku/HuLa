//! 连接用的 token 每次连接时现取，不用建连时存下的那份：
//! access token 两小时过期，期间 HTTP 请求会刷新并轮换 token，旧 token 随即作废。
//! 存下的那份过期后，断线重连会一直被服务端拒绝，而聊天列表和 HTTP 请求都正常
use crate::AppData;
use crate::repository::im_user_repository;
use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

pub enum RefreshOutcome {
    /// 拿到了能用的新 token
    Refreshed(String),
    /// refresh token 也被拒绝，需要重新登录
    Relogin,
    /// 网络等原因没刷新成功，下次重连再试
    Failed,
}

/// 当前登录的 access token（HTTP 请求刷新后会更新这里）
pub async fn current_token(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<AppData>()?;
    let token = state.rc.lock().await.token.clone();
    token.filter(|t| !t.is_empty())
}

/// 服务端拒绝了 `refused` 这个 token：换一个新的。
/// 别的请求已经刷新过（当前 token 已不是它）就直接用当前的
pub async fn refresh_after_refusal(app: &AppHandle, refused: &str) -> RefreshOutcome {
    let Some(state) = app.try_state::<AppData>() else {
        return RefreshOutcome::Failed;
    };
    // 在锁里取副本就放开锁，刷新请求慢时不挡住其他请求
    let mut rc = {
        let guard = state.rc.lock().await;
        if let Some(token) = guard.token.as_deref()
            && !token.is_empty()
            && token != refused
        {
            return RefreshOutcome::Refreshed(token.to_owned());
        }
        guard.clone()
    };
    let used_refresh_token = rc.refresh_token.clone();

    if let Err(e) = rc.start_refresh_token().await {
        if e.to_string().contains("请重新登录") {
            warn!("WebSocket token refused and refresh token rejected, asking to sign in again");
            emit_relogin(app);
            return RefreshOutcome::Relogin;
        }
        warn!("WebSocket token refresh failed: {}", e);
        return RefreshOutcome::Failed;
    }

    let adopted = state
        .rc
        .lock()
        .await
        .adopt_refreshed_tokens(&used_refresh_token, &rc);
    if let (true, Some(token), Some(refresh_token)) =
        (adopted, rc.token.as_deref(), rc.refresh_token.as_deref())
    {
        let uid = state.user_info.lock().await.uid.clone();
        if !uid.is_empty() {
            im_user_repository::save_user_tokens(
                &*state.db_conn.read().await,
                &uid,
                token,
                refresh_token,
            )
            .await
            .ok();
        }
    }
    info!("WebSocket token refreshed after the server refused it");
    match rc.token {
        Some(token) if !token.is_empty() => RefreshOutcome::Refreshed(token),
        _ => RefreshOutcome::Failed,
    }
}

fn emit_relogin(app: &AppHandle) {
    let _ = if app.get_webview_window("home").is_some() {
        app.emit_to("home", "relogin", ())
    } else if app.get_webview_window("mobile-home").is_some() {
        app.emit_to("mobile-home", "relogin", ())
    } else {
        app.emit("relogin", ())
    };
}
