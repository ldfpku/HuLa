//! 麦克风、摄像头的系统授权（macOS 隐私设置）。
//!
//! WKWebView 里 getUserMedia 被拒时只给出 NotAllowedError，分不清是“系统还没问过”、
//! “用户拒绝过”还是“应用缺少授权声明”。这里直接问 AVFoundation：
//! - [`media_permission_status`] 查当前状态；
//! - [`media_permission_request`] 状态为未询问时由应用本身弹出系统授权框，
//!   这样隐私设置的列表里一定会登记 SMJ；
//! - [`media_permission_reset`] 用 tccutil 清掉本应用的记录再重新询问。安装包是临时签名，
//!   每次升级签名都会变，旧记录可能失效（开关是开的却仍被拒，或列表里找不到），重置后即可恢复。
//!
//! 其他平台没有对应的系统授权，状态一律返回 authorized，由网页自己的权限处理。

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[serde(rename_all = "snake_case")]
pub enum MediaPermissionStatus {
    /// 系统还没问过（列表里也不会有本应用）
    NotDetermined,
    /// 被家长控制或企业描述文件限制，用户自己改不了
    Restricted,
    /// 用户拒绝过，或应用缺少授权声明被系统直接拒绝
    Denied,
    Authorized,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::MediaPermissionStatus;
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, Bool};
    use objc2_foundation::NSString;
    use std::sync::{Mutex, mpsc};
    use std::time::Duration;

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {}

    /// AVMediaTypeAudio / AVMediaTypeVideo 的取值
    fn media_type(kind: &str) -> objc2::rc::Retained<NSString> {
        NSString::from_str(if kind == "camera" { "vide" } else { "soun" })
    }

    fn capture_device_class() -> Result<&'static AnyClass, String> {
        AnyClass::get(c"AVCaptureDevice").ok_or_else(|| "AVCaptureDevice 不可用".to_string())
    }

    pub fn status(kind: &str) -> Result<MediaPermissionStatus, String> {
        let class = capture_device_class()?;
        let media = media_type(kind);
        let raw: isize = unsafe { msg_send![class, authorizationStatusForMediaType: &*media] };
        Ok(match raw {
            0 => MediaPermissionStatus::NotDetermined,
            1 => MediaPermissionStatus::Restricted,
            2 => MediaPermissionStatus::Denied,
            _ => MediaPermissionStatus::Authorized,
        })
    }

    /// 弹出系统授权框并等待用户选择（用户不理会时最多等 2 分钟）
    pub fn request_blocking(kind: &str) -> Result<bool, String> {
        let class = capture_device_class()?;
        let media = media_type(kind);
        let (tx, rx) = mpsc::channel::<bool>();
        let tx = Mutex::new(Some(tx));
        let handler = RcBlock::new(move |granted: Bool| {
            if let Some(tx) = tx.lock().ok().and_then(|mut guard| guard.take()) {
                let _ = tx.send(granted.as_bool());
            }
        });
        unsafe {
            let _: () = msg_send![
                class,
                requestAccessForMediaType: &*media,
                completionHandler: &*handler
            ];
        }
        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "等待系统授权超时".to_string())
    }

    pub fn reset(kind: &str, bundle_id: &str) -> Result<(), String> {
        let service = if kind == "camera" {
            "Camera"
        } else {
            "Microphone"
        };
        let output = std::process::Command::new("/usr/bin/tccutil")
            .args(["reset", service, bundle_id])
            .output()
            .map_err(|e| format!("无法执行 tccutil: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
}

fn check_kind(kind: &str) -> Result<(), String> {
    match kind {
        "microphone" | "camera" => Ok(()),
        _ => Err(format!("未知设备类型: {kind}")),
    }
}

/// 查询麦克风（microphone）或摄像头（camera）的系统授权状态
#[tauri::command]
pub fn media_permission_status(kind: String) -> Result<MediaPermissionStatus, String> {
    check_kind(&kind)?;
    #[cfg(target_os = "macos")]
    {
        mac::status(&kind)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(MediaPermissionStatus::Authorized)
    }
}

/// 由应用弹出系统授权框，返回授权后的状态。已经决定过的不会再弹，直接返回当前状态。
#[tauri::command]
pub async fn media_permission_request(kind: String) -> Result<MediaPermissionStatus, String> {
    check_kind(&kind)?;
    #[cfg(target_os = "macos")]
    {
        if mac::status(&kind)? != MediaPermissionStatus::NotDetermined {
            return mac::status(&kind);
        }
        let request_kind = kind.clone();
        tokio::task::spawn_blocking(move || mac::request_blocking(&request_kind))
            .await
            .map_err(|e| e.to_string())??;
        mac::status(&kind)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(MediaPermissionStatus::Authorized)
    }
}

/// 清掉本应用的授权记录后重新弹出系统授权框，返回授权后的状态
#[tauri::command]
pub async fn media_permission_reset(
    app: tauri::AppHandle,
    kind: String,
) -> Result<MediaPermissionStatus, String> {
    check_kind(&kind)?;
    #[cfg(target_os = "macos")]
    {
        let bundle_id = app.config().identifier.clone();
        mac::reset(&kind, &bundle_id)?;
        media_permission_request(kind).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(MediaPermissionStatus::Authorized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_serializes_as_snake_case() {
        let json = serde_json::to_string(&MediaPermissionStatus::NotDetermined).unwrap();
        assert_eq!(json, "\"not_determined\"");
    }

    #[test]
    fn only_microphone_and_camera_are_accepted() {
        assert!(check_kind("microphone").is_ok());
        assert!(check_kind("camera").is_ok());
        assert!(check_kind("screen").is_err());
    }
}
