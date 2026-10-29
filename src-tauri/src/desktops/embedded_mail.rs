use crate::AppData;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, State, Webview, WebviewUrl,
    webview::{NewWindowResponse, WebviewBuilder},
};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const LABEL: &str = "embedded-mail";

#[derive(Clone, Copy, Deserialize)]
pub struct MailViewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl MailViewBounds {
    fn validate(self) -> Result<Self, String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|value| !value.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
        {
            return Err("邮件工作区尺寸无效".into());
        }
        Ok(self)
    }
}

fn validate_sso_url(base: &str, value: &str) -> Result<Url, String> {
    let base = Url::parse(base).map_err(|_| "邮件服务地址无效")?;
    let url = Url::parse(value).map_err(|_| "邮件登录地址无效")?;
    let code = url
        .path()
        .strip_prefix("/api/im/mail/sso/")
        .ok_or("邮件登录地址无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.origin() != base.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || code.len() != 48
        || !code.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("邮件登录地址无效".into());
    }
    Ok(url)
}

fn require_home<R: Runtime>(caller: &Webview<R>) -> Result<(), String> {
    if caller.label() != "home" {
        return Err("只有主窗口可以操作邮件工作区".into());
    }
    Ok(())
}

fn validate_account(uid: &str, token: &str, account: &str) -> Result<(), String> {
    if uid.is_empty() || token.is_empty() || uid != account {
        return Err("账号已切换或退出，请重新打开邮件".into());
    }
    Ok(())
}

fn open_external<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        return;
    }
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("打开外部链接失败: {error}");
        let _ = app.emit_to("home", "mail-workspace-error", "打开外部链接失败");
    }
}

#[tauri::command]
pub async fn create_embedded_mail<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    state: State<'_, AppData>,
    url: String,
    account: String,
    bounds: MailViewBounds,
) -> Result<(), String> {
    require_home(&caller)?;
    let bounds = bounds.validate()?;
    let base = state.config.lock().await.backend.base_url.clone();
    let url = validate_sso_url(&base, &url)?;
    let user = state.user_info.lock().await;
    let uid = &user.uid;
    validate_account(uid, &user.token, &account)?;
    if app.get_webview(LABEL).is_some() {
        return Err("邮件工作区已存在".into());
    }
    let window = app.get_window("home").ok_or("主窗口不存在")?;
    let origin = url.origin();
    let nav_origin = origin.clone();
    let nav_app = app.clone();
    let new_window_app = app.clone();
    let account_hash = Sha256::digest(uid.as_bytes());
    let mut store_id = [0_u8; 16];
    store_id.copy_from_slice(&account_hash[..16]);
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取邮件数据目录失败: {error}"))?
        .join("mail-workspaces")
        .join(format!("{account_hash:x}"));
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .data_directory(directory)
        .data_store_identifier(store_id)
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |next| {
            if next.origin() == nav_origin {
                true
            } else {
                open_external(&nav_app, next);
                false
            }
        })
        .on_new_window(move |next, _features| {
            if next.origin() == origin {
                match new_window_app.get_webview(LABEL) {
                    Some(webview) => {
                        if let Err(error) = webview.navigate(next) {
                            eprintln!("打开邮件页面失败: {error}");
                            let _ = new_window_app.emit_to("home", "mail-workspace-error", "打开邮件页面失败");
                        }
                    }
                    None => {
                        let _ = new_window_app.emit_to("home", "mail-workspace-error", "邮件工作区不可用");
                    }
                }
            } else {
                open_external(&new_window_app, &next);
            }
            NewWindowResponse::Deny
        });
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| format!("创建邮件工作区失败: {error}"))?;
    if let Err(error) = webview.hide() {
        if let Err(close_error) = webview.close() {
            return Err(format!("初始化邮件工作区失败: {error}; 关闭邮件工作区失败: {close_error}"));
        }
        return Err(format!("初始化邮件工作区失败: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn navigate_embedded_mail<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    state: State<'_, AppData>,
    url: String,
    account: String,
) -> Result<(), String> {
    require_home(&caller)?;
    let base = state.config.lock().await.backend.base_url.clone();
    let url = validate_sso_url(&base, &url)?;
    let user = state.user_info.lock().await;
    validate_account(&user.uid, &user.token, &account)?;
    app.get_webview(LABEL)
        .ok_or("邮件工作区不存在")?
        .navigate(url)
        .map_err(|error| format!("打开邮件失败: {error}"))
}

#[tauri::command]
pub async fn update_embedded_mail_bounds<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    bounds: MailViewBounds,
) -> Result<(), String> {
    require_home(&caller)?;
    let bounds = bounds.validate()?;
    let webview = app.get_webview(LABEL).ok_or("邮件工作区不存在")?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| format!("更新邮件工作区位置失败: {error}"))?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| format!("更新邮件工作区大小失败: {error}"))
}

#[tauri::command]
pub async fn set_embedded_mail_visible<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    visible: bool,
) -> Result<(), String> {
    require_home(&caller)?;
    let webview = app.get_webview(LABEL).ok_or("邮件工作区不存在")?;
    if visible {
        webview.show()
    } else {
        webview.hide()
    }
    .map_err(|error| format!("切换邮件工作区失败: {error}"))
}

#[tauri::command]
pub async fn close_embedded_mail<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
) -> Result<(), String> {
    require_home(&caller)?;
    if let Some(webview) = app.get_webview(LABEL) {
        webview.close().map_err(|error| format!("关闭邮件工作区失败: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{MailViewBounds, validate_account, validate_sso_url};

    #[test]
    fn requires_the_current_authenticated_account() {
        assert!(validate_account("a", "token", "a").is_ok());
        assert!(validate_account("a", "", "a").is_err());
        assert!(validate_account("a", "token", "b").is_err());
        assert!(validate_account("", "token", "").is_err());
    }

    #[test]
    fn accepts_only_one_time_links_on_the_configured_origin() {
        let code = "a".repeat(48);
        let valid = format!("https://mail.example.test/api/im/mail/sso/{code}?next=%2Finbox");
        assert!(validate_sso_url("https://mail.example.test/api/im", &valid).is_ok());
        for invalid in [
            format!("https://other.example.test/api/im/mail/sso/{code}"),
            format!("https://mail.example.test@other.example.test/api/im/mail/sso/{code}"),
            "https://mail.example.test/inbox".into(),
            "https://mail.example.test/api/im/mail/sso/short".into(),
        ] {
            assert!(validate_sso_url("https://mail.example.test/api/im", &invalid).is_err());
        }
    }

    #[test]
    fn rejects_invalid_bounds() {
        let valid = MailViewBounds { x: 64.0, y: 30.0, width: 800.0, height: 600.0 };
        assert!(valid.validate().is_ok());
        assert!(MailViewBounds { width: 0.0, ..valid }.validate().is_err());
        assert!(MailViewBounds { x: f64::NAN, ..valid }.validate().is_err());
    }
}
