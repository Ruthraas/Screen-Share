use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const SCHEME: &str = "screenshare://";
static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static PENDING: OnceLock<Mutex<Option<mpsc::Sender<String>>>> = OnceLock::new();

// Recupera de "poison" em vez de propagar o panic (ver comentario igual em
// capture.rs `running()`) — nunca deveria travar todo login futuro por causa
// de um panic acidental segurando este lock antes.
fn pending() -> &'static Mutex<Option<mpsc::Sender<String>>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

/// Log de diagnóstico da navegação desktop (issue #23) — nunca imprime a
/// URL/fragmento cru de retorno do OAuth (carrega `access_token`/
/// `refresh_token` em texto puro), só `provider` e códigos de erro seguros
/// (os mesmos 5 do backend + os gerados aqui, documentados em
/// `authClient.ts`/`CLIENT_ONLY_MESSAGES`). `debug` só imprime em build de
/// debug (critério de aceite: "producao nao exibe debug excessivo");
/// `info`/`warn` sempre imprimem, iguais ao nível equivalente no lado JS.
fn log_debug(event: &str, provider: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[desktop] debug {event} provider={provider}");
    #[cfg(not(debug_assertions))]
    let _ = (event, provider);
}

fn log_info(event: &str, provider: &str) {
    eprintln!("[desktop] info {event} provider={provider}");
}

fn log_warn(event: &str, provider: &str, code: &str) {
    eprintln!("[desktop] warn {event} provider={provider} code={code}");
}

/// Chamado pelo plugin `single-instance` (issue #1): no Windows, clicar num
/// link `screenshare://...` relança o app com a URL como argumento de linha
/// de comando em vez de emitir evento do plugin `deep-link` (que só
/// funciona em macOS/iOS/Android) — o SO encaminha esse relançamento pra
/// instância já aberta, que é exatamente a que está esperando o resultado
/// do OAuth em `login()`.
pub fn handle_second_instance_argv(argv: Vec<String>) {
    if let Some(url) = argv.iter().find(|arg| arg.starts_with(SCHEME)) {
        // Nunca loga `url`: é o retorno do OAuth, carrega os tokens em texto
        // puro no fragmento. Só registra que um deep link chegou e se havia
        // alguém esperando por ele (login em andamento) ou não (clique
        // órfão/repetido no link).
        #[cfg(debug_assertions)]
        {
            let had_pending = pending().lock().unwrap_or_else(|poisoned| poisoned.into_inner()).is_some();
            eprintln!("[desktop] debug deep-link-received had_pending={had_pending}");
        }
        if let Some(sender) = pending().lock().unwrap_or_else(|poisoned| poisoned.into_inner()).as_ref() {
            let _ = sender.send(url.clone());
        }
    }
}

/// Tokens da sessão emitidos pelo backend (issue #30), extraídos do
/// fragmento da URL de retorno — nunca chegam pelo servidor/log, só pelo
/// argv local do relançamento do app.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    access_token: Option<String>,
    refresh_token: Option<String>,
    error: Option<String>,
}

fn parse_fragment(url: &str) -> HashMap<String, String> {
    let Some((_, fragment)) = url.split_once('#') else { return HashMap::new(); };
    url::form_urlencoded::parse(fragment.as_bytes()).into_owned().collect()
}

fn extract_oauth_result(url: &str) -> Result<OAuthResult, String> {
    let params = parse_fragment(url);
    // O backend já manda um dos 5 códigos conhecidos e seguros de exibir
    // (`docs/BACKEND.md` §4: invalid_state, missing_code, provider_error,
    // provider_not_configured, provider_unknown) — repassa direto, sem
    // reescrever; `authClient.ts` traduz o mesmo vocabulário nos dois
    // transportes (web e desktop).
    if let Some(error) = params.get("error") {
        return Err(error.clone());
    }
    match (
        params.get("access_token").filter(|v| !v.is_empty()),
        params.get("refresh_token").filter(|v| !v.is_empty()),
    ) {
        (Some(access), Some(refresh)) => Ok(OAuthResult {
            access_token: Some(access.clone()),
            refresh_token: Some(refresh.clone()),
            error: None,
        }),
        _ => Err("desktop-auth-provider-failed".into()),
    }
}

fn login(provider: String, api_url: String) -> Result<OAuthResult, String> {
    let (tx, rx) = mpsc::channel::<String>();
    *pending().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(tx);
    log_debug("start", &provider);

    // `target=desktop`: preparado pro backend poder escolher entre mais de
    // um OAUTH_FRONTEND_REDIRECT_URL configurado (hoje só existe um por vez,
    // combinado com @ProgVictorPe — o backend ainda ignora esse parâmetro,
    // então mandar já não quebra nada).
    let start_url = format!("{}/v1/auth/oauth/{provider}/start?target=desktop", api_url.trim_end_matches('/'));
    if open::that(start_url).is_err() {
        *pending().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        log_warn("browser-open-failed", &provider, "desktop-browser-failed");
        return Err("desktop-browser-failed".into());
    }

    let deadline = Instant::now() + Duration::from_secs(180);
    let outcome = loop {
        if CANCEL.swap(false, Ordering::SeqCst) {
            log_info("cancelled", &provider);
            break Err("desktop-auth-cancelled".to_string());
        }
        if Instant::now() >= deadline {
            log_warn("timeout", &provider, "desktop-auth-timeout");
            break Err("desktop-auth-timeout".to_string());
        }
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(url) => {
                let result = extract_oauth_result(&url);
                match &result {
                    Ok(_) => log_info("completed", &provider),
                    Err(code) => log_warn("provider-error", &provider, code),
                }
                break result;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                log_warn("channel-disconnected", &provider, "desktop-auth-failed");
                break Err("desktop-auth-failed".to_string());
            }
        }
    };

    *pending().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    outcome
}

#[tauri::command]
pub async fn desktop_oauth_login(provider: String, api_url: String) -> Result<OAuthResult, String> {
    if !matches!(provider.as_str(), "google" | "github" | "discord") {
        return Err("desktop-invalid-provider".into());
    }
    if api_url.trim().is_empty() {
        return Err("desktop-server-failed".into());
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("desktop-auth-busy".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let result = tauri::async_runtime::spawn_blocking(move || login(provider, api_url)).await;
    BUSY.store(false, Ordering::SeqCst);
    result.map_err(|_| "desktop-auth-failed".to_string())?
}

/// Permite que a UI cancele uma tentativa em andamento (ex.: botão
/// "cancelar" enquanto aguarda o navegador).
#[tauri::command]
pub fn desktop_oauth_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_result_reads_tokens_from_the_fragment() {
        let result = extract_oauth_result("screenshare://oauth-callback#access_token=a&refresh_token=b&provider=google").unwrap();
        assert_eq!(result.access_token, Some("a".to_string()));
        assert_eq!(result.refresh_token, Some("b".to_string()));
        assert!(result.error.is_none());
    }

    #[test]
    fn extract_result_requires_both_tokens() {
        assert!(extract_oauth_result("screenshare://oauth-callback#access_token=a").is_err());
        assert!(extract_oauth_result("screenshare://oauth-callback#refresh_token=b").is_err());
        assert!(extract_oauth_result("screenshare://oauth-callback").is_err());
    }

    #[test]
    fn extract_result_relays_backend_error_codes_unchanged() {
        assert_eq!(extract_oauth_result("screenshare://oauth-callback#error=invalid_state").unwrap_err(), "invalid_state");
        assert_eq!(extract_oauth_result("screenshare://oauth-callback#error=provider_not_configured").unwrap_err(), "provider_not_configured");
        assert_eq!(extract_oauth_result("screenshare://oauth-callback#error=provider_unknown").unwrap_err(), "provider_unknown");
    }

    #[test]
    fn second_instance_argv_without_pending_login_does_not_panic() {
        handle_second_instance_argv(vec!["ScreenShare.exe".to_string()]);
        handle_second_instance_argv(vec!["ScreenShare.exe".to_string(), "screenshare://oauth-callback#access_token=a&refresh_token=b".to_string()]);
    }
}
