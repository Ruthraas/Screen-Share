#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_auth::desktop_oauth_login,
            desktop_auth::desktop_oauth_cancel,
            secure_store::secure_store_set,
            secure_store::secure_store_get,
            secure_store::secure_store_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ScreenShare");
}
mod desktop_auth;
mod secure_store;
