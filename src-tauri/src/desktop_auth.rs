use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use std::{io::Read, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};
use tiny_http::{Header, Method, Request, Response, Server};

static ASSETS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../dist");
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    #[serde(skip_serializing)]
    state: String,
    id_token: Option<String>,
    access_token: Option<String>,
}

fn header(request: &Request, name: &str) -> Option<String> {
    request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

fn valid_credential(value: &Credential, state: &str, provider: &str) -> bool {
    value.state == state && match provider {
        "google" => value.id_token.as_ref().is_some_and(|token| !token.is_empty()),
        "github" => value.access_token.as_ref().is_some_and(|token| !token.is_empty()),
        _ => false,
    }
}

fn login(provider: String) -> Result<Credential, String> {
    let server = Server::http("127.0.0.1:0").map_err(|_| "desktop-server-failed")?;
    let address = server.server_addr().to_ip().ok_or("desktop-server-failed")?;
    let origin = format!("http://{address}");
    let nonce = uuid::Uuid::new_v4().to_string();
    open::that(format!("{origin}/oauth.html#provider={provider}&state={nonce}")).map_err(|_| "desktop-browser-failed")?;
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        let Some(mut request) = server.recv_timeout(Duration::from_millis(250)).map_err(|_| "desktop-server-failed")? else { continue; };
        if header(&request, "Host").as_deref() != Some(address.to_string().as_str()) {
            let _ = request.respond(Response::empty(403));
            continue;
        }
        let path = request.url().split('?').next().unwrap_or("").to_string();
        if request.method() == &Method::Post && path == "/complete" {
            if header(&request, "Origin").as_deref() != Some(origin.as_str())
                || header(&request, "Content-Type").as_deref() != Some("application/json")
                || request.body_length().map_or(true, |size| size > 16384) {
                let _ = request.respond(Response::empty(403));
                continue;
            }
            let mut body = String::new();
            if request.as_reader().take(16385).read_to_string(&mut body).is_err() {
                let _ = request.respond(Response::empty(400)); continue;
            }
            let parsed = serde_json::from_str::<Credential>(&body);
            match parsed {
                Ok(value) if valid_credential(&value, &nonce, &provider) => {
                    let _ = request.respond(Response::empty(204));
                    return Ok(value);
                }
                _ => { let _ = request.respond(Response::empty(403)); }
            }
        } else if request.method() == &Method::Get && (path == "/oauth.html" || path.starts_with("/assets/")) {
            if let Some(file) = ASSETS.get_file(path.trim_start_matches('/')) {
                let mime = if path.ends_with(".html") { "text/html; charset=utf-8" } else if path.ends_with(".js") { "text/javascript" } else if path.ends_with(".css") { "text/css" } else { "application/octet-stream" };
                let response = Response::from_data(file.contents())
                    .with_header(Header::from_bytes("Content-Type", mime).unwrap())
                    .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
                    .with_header(Header::from_bytes("Referrer-Policy", "no-referrer").unwrap())
                    .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap());
                let _ = request.respond(response);
            } else { let _ = request.respond(Response::empty(404)); }
        } else { let _ = request.respond(Response::empty(404)); }
    }
    Err("desktop-auth-timeout".into())
}

#[tauri::command]
pub async fn desktop_login(provider: String) -> Result<Credential, String> {
    if !matches!(provider.as_str(), "google" | "github") { return Err("desktop-invalid-provider".into()); }
    if BUSY.swap(true, Ordering::SeqCst) { return Err("desktop-auth-busy".into()); }
    let result = tauri::async_runtime::spawn_blocking(move || login(provider)).await;
    BUSY.store(false, Ordering::SeqCst);
    result.map_err(|_| "desktop-auth-failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_requires_matching_state_and_provider_credential() {
        let google = Credential { state: "expected".into(), id_token: Some("id".into()), access_token: None };
        assert!(valid_credential(&google, "expected", "google"));
        assert!(!valid_credential(&google, "other", "google"));
        assert!(!valid_credential(&google, "expected", "github"));
        assert!(!valid_credential(&google, "expected", "unknown"));
    }
    #[test]
    fn nonce_is_not_returned_to_frontend() {
        let value = Credential { state: "secret".into(), id_token: None, access_token: Some("token".into()) };
        assert!(!serde_json::to_string(&value).unwrap().contains("secret"));
    }
}
