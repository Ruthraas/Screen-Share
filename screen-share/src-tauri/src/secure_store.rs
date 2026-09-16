use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "com.screenshare.desktop";

/// Armazenamento seguro de segredos do cliente (issue #2: refresh token
/// "nunca é logado nem persistido fora do armazenamento seguro do Tauri").
/// Usa o Gerenciador de Credenciais do Windows via `keyring`; nunca escreve
/// o valor em disco em texto plano nem em log.
fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|_| "secure-store-unavailable".to_string())
}

#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|_| "secure-store-unavailable".to_string())
}

#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err("secure-store-unavailable".to_string()),
    }
}

#[tauri::command]
pub fn secure_store_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err("secure-store-unavailable".to_string()),
    }
}
