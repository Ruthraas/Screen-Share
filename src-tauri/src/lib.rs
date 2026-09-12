#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_auth::desktop_login])
        .run(tauri::generate_context!())
        .expect("error while running ScreenShare");
}
mod desktop_auth;
