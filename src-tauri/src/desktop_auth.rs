use serde::Serialize;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tiny_http::{Header, Method, Request, Response, Server};

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

const SUCCESS_PAGE: &str = "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>screenshare</title></head><body style=\"font-family:monospace;background:#0A0C0B;color:#E4E7E0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><p>login concluido. volte ao screenshare; esta aba pode ser fechada</p></body></html>";

/// Resultado devolvido ao frontend (issue #1/#30): nunca o token em si, só
/// um `handoff_code` de uso único que `authClient.ts` troca pela sessão via
/// HTTPS direto com o backend — o código nunca fica só na URL/histórico do
/// navegador depois desse ponto.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OAuthResult {
    handoff_code: Option<String>,
    error: Option<String>,
}

fn header(request: &Request, name: &str) -> Option<String> {
    request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

fn parse_query(url: &str) -> HashMap<String, String> {
    let Some((_, query)) = url.split_once('?') else { return HashMap::new(); };
    let base = url::Url::parse(&format!("http://local/?{query}"));
    match base {
        Ok(parsed) => parsed.query_pairs().into_owned().collect(),
        Err(_) => HashMap::new(),
    }
}

fn normalize_provider_error(error: &str) -> String {
    match error {
        "access_denied" | "cancelled" => "desktop-auth-cancelled".into(),
        _ => "desktop-auth-provider-failed".into(),
    }
}

/// Interpreta os query params já validados (state conferido) do callback:
/// erro do provedor/backend vira código normalizado; sucesso exige um
/// `handoff_code` não vazio.
fn extract_oauth_result(params: &HashMap<String, String>) -> Result<OAuthResult, String> {
    if let Some(error) = params.get("error") {
        return Err(normalize_provider_error(error));
    }
    match params.get("handoff_code").filter(|value| !value.is_empty()) {
        Some(code) => Ok(OAuthResult { handoff_code: Some(code.clone()), error: None }),
        None => Err("desktop-auth-provider-failed".into()),
    }
}

fn login(provider: String, api_url: String) -> Result<OAuthResult, String> {
    let server = Server::http("127.0.0.1:0").map_err(|_| "desktop-server-failed")?;
    let address = server.server_addr().to_ip().ok_or("desktop-server-failed")?;
    let redirect_uri = format!("http://{address}/complete");
    let state = uuid::Uuid::new_v4().to_string();

    let start_url = format!(
        "{}/v1/auth/oauth/{provider}/start?{}",
        api_url.trim_end_matches('/'),
        url::form_urlencoded::Serializer::new(String::new())
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("state", &state)
            .finish(),
    );
    open::that(start_url).map_err(|_| "desktop-browser-failed")?;

    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        if CANCEL.swap(false, Ordering::SeqCst) {
            return Err("desktop-auth-cancelled".into());
        }

        let Some(request) = server.recv_timeout(Duration::from_millis(250)).map_err(|_| "desktop-server-failed")? else { continue; };

        if header(&request, "Host").as_deref() != Some(address.to_string().as_str()) {
            let _ = request.respond(Response::empty(403));
            continue;
        }

        let path = request.url().split('?').next().unwrap_or("").to_string();
        if request.method() != &Method::Get || path != "/complete" {
            let _ = request.respond(Response::empty(404));
            continue;
        }

        let params = parse_query(request.url());
        if params.get("state").map(String::as_str) != Some(state.as_str()) {
            let _ = request.respond(Response::empty(403));
            continue;
        }

        let response = Response::from_string(SUCCESS_PAGE)
            .with_header(Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap())
            .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
            .with_header(Header::from_bytes("Referrer-Policy", "no-referrer").unwrap())
            .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap());
        let _ = request.respond(response);

        return extract_oauth_result(&params);
    }
    Err("desktop-auth-timeout".into())
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
/// "cancelar" enquanto aguarda o navegador) sem depender de JS rodando na
/// aba externa, que deixou de existir com o backend próprio.
#[tauri::command]
pub fn desktop_oauth_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_result_requires_non_empty_handoff_code() {
        let mut params = HashMap::new();
        params.insert("state".to_string(), "s".to_string());
        assert_eq!(extract_oauth_result(&params).unwrap_err(), "desktop-auth-provider-failed");

        params.insert("handoff_code".to_string(), "".to_string());
        assert_eq!(extract_oauth_result(&params).unwrap_err(), "desktop-auth-provider-failed");

        params.insert("handoff_code".to_string(), "abc123".to_string());
        let result = extract_oauth_result(&params).unwrap();
        assert_eq!(result.handoff_code, Some("abc123".to_string()));
        assert!(result.error.is_none());
    }

    #[test]
    fn extract_result_normalizes_provider_errors() {
        let mut params = HashMap::new();
        params.insert("error".to_string(), "access_denied".to_string());
        assert_eq!(extract_oauth_result(&params).unwrap_err(), "desktop-auth-cancelled");

        params.insert("error".to_string(), "server_error".to_string());
        assert_eq!(extract_oauth_result(&params).unwrap_err(), "desktop-auth-provider-failed");
    }

    #[test]
    fn handoff_code_is_never_returned_alongside_an_error() {
        let mut params = HashMap::new();
        params.insert("error".to_string(), "access_denied".to_string());
        params.insert("handoff_code".to_string(), "leaked".to_string());
        assert!(extract_oauth_result(&params).is_err());
    }

    #[test]
    fn parse_query_reads_percent_encoded_values() {
        let params = parse_query("/complete?state=abc&handoff_code=x%2Fy");
        assert_eq!(params.get("state"), Some(&"abc".to_string()));
        assert_eq!(params.get("handoff_code"), Some(&"x/y".to_string()));
    }
}
