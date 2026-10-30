use crate::AppData;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State, Webview};
use tauri_winrt_notification::Toast;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MailNotificationClick {
    account: String,
    message_id: String,
}

fn validate_notification(caller: &str, message_id: &str, uid: &str, token: &str) -> Result<(), String> {
    if caller != "home" {
        return Err("只有主窗口可以发送邮件通知".into());
    }
    if message_id.is_empty() || message_id.len() > 256 {
        return Err("邮件通知无效".into());
    }
    if uid.is_empty() || token.is_empty() {
        return Err("账号已退出，无法显示邮件通知".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn show_mail_notification<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    state: State<'_, AppData>,
    message_id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let user = state.user_info.lock().await;
    validate_notification(caller.label(), &message_id, &user.uid, &user.token)?;
    let payload = MailNotificationClick { account: user.uid.clone(), message_id };
    drop(user);
    let app_id = if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID
    } else {
        app.config().identifier.as_str()
    };
    let title: String = title.chars().take(200).collect();
    let body: String = body.chars().take(500).collect();
    let handle = app.clone();
    Toast::new(app_id)
        .title(&title)
        .text1(&body)
        .on_activated(move |_| {
            if let Err(error) = handle.emit_to("home", "mail-notification-click", payload.clone()) {
                tracing::error!("Failed to deliver mail notification click: {}", error);
            }
            Ok(())
        })
        .show()
        .map_err(|error| format!("显示邮件通知失败: {error}"))?;
    tracing::debug!("Mail notification submitted to the operating system");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_notification;

    #[test]
    fn requires_a_home_window_valid_message_and_authenticated_account() {
        assert!(validate_notification("home", "message", "user", "token").is_ok());
        assert!(validate_notification("tray", "message", "user", "token").is_err());
        assert!(validate_notification("home", "", "user", "token").is_err());
        assert!(validate_notification("home", &"x".repeat(257), "user", "token").is_err());
        assert!(validate_notification("home", "message", "", "token").is_err());
        assert!(validate_notification("home", "message", "user", "").is_err());
    }
}
