use tauri::{AppHandle, Manager, Runtime, image::Image};

#[tauri::command]
pub async fn set_mail_window_identity<R: Runtime>(
    app: AppHandle<R>,
    label: String,
) -> Result<(), String> {
    if label != "mail" && !label.starts_with("mail-share-") && !label.starts_with("mail-message-")
    {
        return Err("无效的邮件窗口标识".into());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("邮件窗口不存在: {label}"))?;
    let icon = Image::from_bytes(include_bytes!("../../icons/mail/128x128.png"))
        .map_err(|error| format!("读取邮件窗口图标失败: {error}"))?;
    window
        .set_icon(icon)
        .map_err(|error| format!("设置邮件窗口图标失败: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let result = set_windows_mail_app_id(&target);
                let _ = sender.send(result);
            })
            .map_err(|error| format!("设置邮件任务栏分组失败: {error}"))?;
        receiver
            .await
            .map_err(|error| format!("设置邮件任务栏分组失败: {error}"))??;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_windows_mail_app_id<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    apply_windows_mail_app_id(HWND(hwnd.0 as _))
}

#[cfg(target_os = "windows")]
fn apply_windows_mail_app_id(hwnd: windows::Win32::Foundation::HWND) -> Result<(), String> {
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};

    unsafe {
        let store: IPropertyStore =
            SHGetPropertyStoreForWindow(hwnd).map_err(|error| error.to_string())?;
        let app_id = PROPVARIANT::from("com.smjtools.desktop.mail");
        store
            .SetValue(&PKEY_AppUserModel_ID, &app_id)
            .map_err(|error| error.to_string())?;
        store.Commit().map_err(|error| error.to_string())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::apply_windows_mail_app_id;
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToString;
    use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WINDOW_STYLE,
    };
    use windows::core::w;

    #[test]
    fn mail_icon_is_distinct_from_chat_icon() {
        let mail = tauri::image::Image::from_bytes(include_bytes!("../../icons/mail/128x128.png"))
            .expect("decode mail icon");
        let chat = tauri::image::Image::from_bytes(include_bytes!("../../icons/desktop/128x128.png"))
            .expect("decode chat icon");
        assert_eq!((mail.width(), mail.height()), (128, 128));
        assert_eq!((chat.width(), chat.height()), (128, 128));
        assert_ne!(mail.rgba(), chat.rgba());
    }

    #[test]
    fn sets_a_distinct_app_id_on_a_native_window() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .expect("initialize COM");
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!(""),
                WINDOW_STYLE::default(),
                0,
                0,
                1,
                1,
                None,
                None,
                None,
                None,
            )
            .expect("create hidden window");
            apply_windows_mail_app_id(hwnd).expect("set app id");
            let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).expect("property store");
            let value = store.GetValue(&PKEY_AppUserModel_ID).expect("get app id");
            let mut buffer = [0u16; 128];
            PropVariantToString(&value, &mut buffer).expect("read app id");
            let length = buffer.iter().position(|ch| *ch == 0).unwrap();
            assert_eq!(
                String::from_utf16(&buffer[..length]).unwrap(),
                "com.smjtools.desktop.mail"
            );
            drop(value);
            drop(store);
            DestroyWindow(hwnd).expect("destroy hidden window");
            CoUninitialize();
        }
    }
}
