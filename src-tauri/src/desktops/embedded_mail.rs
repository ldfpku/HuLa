use crate::AppData;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, State, Webview, WebviewUrl,
    webview::{DownloadEvent, NewWindowResponse, WebviewBuilder},
};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const LABEL: &str = "embedded-mail";
const PREPARE_NAVIGATION: &str = r#"(() => {
    try {
        const guard = window.__smjMailNavigation;
        if (!guard || typeof guard.prepare !== "function") return "unavailable";
        return guard.prepare() ? "ready" : "pending";
    } catch (error) {
        console.error("Preparing mail navigation failed", error);
        return "error";
    }
})()"#;
const RELEASE_NAVIGATION: &str = "window.__smjMailNavigation?.release()";

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

fn is_read_only_share(url: &Url) -> bool {
    url.path()
        .strip_prefix("/api/im/mail/share/")
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

async fn navigate_safely<R: Runtime>(webview: Webview<R>, next: Url) -> Result<(), String> {
    let current = webview.url().map_err(|error| format!("读取邮件页面地址失败: {error}"))?;
    if current.origin() != next.origin() {
        return Err("邮件页面来源已改变，请重新打开邮件".into());
    }
    let locked = prepare_mail_view(&webview, &current).await?;
    if let Err(error) = webview.navigate(next) {
        if !locked {
            return Err(format!("打开邮件失败: {error}"));
        }
        return match webview.eval(RELEASE_NAVIGATION) {
            Ok(()) => Err(format!("打开邮件失败: {error}")),
            Err(release_error) => Err(format!("打开邮件失败: {error}; 恢复邮件操作失败: {release_error}")),
        };
    }
    Ok(())
}

async fn prepare_mail_view<R: Runtime>(webview: &Webview<R>, current: &Url) -> Result<bool, String> {
    if !is_read_only_share(current) {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = std::sync::Mutex::new(Some(sender));
        webview
            .eval_with_callback(PREPARE_NAVIGATION, move |result| {
                match sender.lock() {
                    Ok(mut sender) => {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(result);
                        }
                    }
                    Err(error) => eprintln!("处理邮件草稿检查结果失败: {error}"),
                }
            })
            .map_err(|error| format!("检查邮件草稿失败: {error}"))?;
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await
            .map_err(|_| "检查邮件草稿超时，请重试".to_string())?
            .map_err(|_| "检查邮件草稿失败，请重试".to_string())?;
        let status: String = serde_json::from_str(&result).map_err(|_| "邮件草稿检查结果无效")?;
        match status.as_str() {
            "ready" => return Ok(true),
            "pending" => return Err("邮件仍有未保存的内容，请先保存或完成编辑".into()),
            _ => return Err("邮件页面尚未准备好，请稍后重试".into()),
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn prepare_embedded_mail_logout<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    state: State<'_, AppData>,
) -> Result<bool, String> {
    require_home(&caller)?;
    let Some(webview) = app.get_webview(LABEL) else { return Ok(false); };
    let current = webview.url().map_err(|error| format!("读取邮件页面地址失败: {error}"))?;
    let base = state.config.lock().await.backend.base_url.clone();
    let base = Url::parse(&base).map_err(|_| "邮件服务地址无效")?;
    if current.origin() != base.origin() {
        return Err("邮件页面来源已改变，请重新打开邮件".into());
    }
    prepare_mail_view(&webview, &current).await
}

#[tauri::command]
pub async fn release_embedded_mail_logout<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
) -> Result<(), String> {
    require_home(&caller)?;
    if let Some(webview) = app.get_webview(LABEL) {
        webview.eval(RELEASE_NAVIGATION).map_err(|error| format!("恢复邮件操作失败: {error}"))?;
    }
    Ok(())
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
        .on_download(|webview, event| {
            match event {
                DownloadEvent::Requested { destination, .. } => {
                    if !destination.is_absolute() {
                        eprintln!("邮件下载路径无效: {}", destination.display());
                        if let Err(error) = webview.app_handle().emit_to("home", "mail-workspace-error", "邮件下载路径无效") {
                            eprintln!("显示邮件下载错误失败: {error}");
                        }
                        return false;
                    }
                }
                DownloadEvent::Finished { path, success, .. } => {
                    let app = webview.app_handle();
                    if success {
                        let message = match path {
                            Some(path) => format!("附件已下载至 {}", path.display()),
                            None => "附件已下载至下载文件夹".to_string(),
                        };
                        if let Err(error) = app.emit_to("home", "mail-workspace-download", message) {
                            eprintln!("显示邮件下载结果失败: {error}");
                        }
                    } else {
                        eprintln!("邮件附件下载失败");
                        if let Err(error) = app.emit_to("home", "mail-workspace-error", "邮件附件下载失败，请重试") {
                            eprintln!("显示邮件下载错误失败: {error}");
                        }
                    }
                }
                _ => {}
            }
            true
        })
        .on_new_window(move |next, _features| {
            if next.origin() == origin {
                match new_window_app.get_webview(LABEL) {
                    Some(webview) => {
                        let app = new_window_app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = navigate_safely(webview, next).await {
                                eprintln!("打开邮件页面失败: {error}");
                                let _ = app.emit_to("home", "mail-workspace-error", format!("{error}，请处理后重新点击链接"));
                            }
                        });
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
    let webview = app.get_webview(LABEL).ok_or("邮件工作区不存在")?;
    navigate_safely(webview, url).await
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
    use super::{MailViewBounds, is_read_only_share, validate_account, validate_sso_url};

    #[test]
    fn only_a_single_share_page_is_treated_as_read_only() {
        let id = "a".repeat(32);
        let url = |path: &str| url::Url::parse(&format!("https://mail.example.test{path}")).unwrap();
        assert!(is_read_only_share(&url(&format!("/api/im/mail/share/{id}"))));
        assert!(!is_read_only_share(&url(&format!("/api/im/mail/share/{id}/attachments/a"))));
        assert!(!is_read_only_share(&url("/api/im/mail/share/not-an-id")));
        assert!(!is_read_only_share(&url("/inbox")));
    }

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
