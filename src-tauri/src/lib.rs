#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Precisa ser o primeiro plugin registrado (doc do
        // tauri-plugin-single-instance) — repassa o argv de um relançamento
        // via `screenshare://...` (deep link no Windows) pra `desktop_auth`.
        .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            desktop_auth::handle_second_instance_argv(argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // O plugin só lê o esquema da config em `tauri.conf.json`; quem
            // efetivamente grava a chave do protocolo no Windows é este
            // `register` (best-effort: falha aqui não deve derrubar o app).
            use tauri_plugin_deep_link::DeepLinkExt;
            let _ = app.deep_link().register("screenshare");
            Ok(())
        })
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
