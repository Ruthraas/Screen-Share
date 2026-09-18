use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, ImageBuffer, Rgba};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};

/// `Window::is_valid()` da `windows-capture` (visibilidade, retangulo de
/// cliente, `WS_EX_TOOLWINDOW`, `WS_CHILD`) NÃO checa se a janela está
/// "cloaked" pelo DWM (comum em apps UWP/janelas de outro desktop virtual —
/// aparecem como visiveis pro Win32 mas não tem nada pra capturar de
/// verdade) — achado real testando: as 3 janelas listadas nesta máquina
/// falhavam 100% das vezes ao converter pra item de captura
/// (`E_INVALIDARG`), e todas eram cloaked. Filtra aqui, antes de expor a
/// fonte pro cliente, em vez de deixar ele escolher algo que nunca vai
/// funcionar.
fn is_cloaked(hwnd: *mut std::ffi::c_void) -> bool {
    let mut cloaked: u32 = 0;
    let result = unsafe {
        DwmGetWindowAttribute(
            HWND(hwnd),
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };
    result.is_ok() && cloaked != 0
}

/// O WebView2 do Tauri já inicializa o COM em modo STA nas threads que
/// entregam comandos (`#[tauri::command]`) — a `windows-capture` tenta
/// inicializar o WinRT em modo MTA nessa mesma thread e falha
/// (`FailedToInitWinRT`, apartment já num modo incompatível; achado real
/// testando a captura de verdade, não suposição). Toda chamada que toca
/// WinRT (resolver um `Monitor`/`Window` num item de captura, abrir a
/// sessão) precisa rodar numa thread nova, sem nenhum COM inicializado
/// ainda, onde a própria inicialização da `windows-capture` funciona limpa.
fn run_on_fresh_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    std::thread::spawn(f)
        .join()
        .map_err(|_| "capture-thread-panic".to_string())
}

/// Resolve o id opaco (`monitor:<indice>` ou `window:<hwnd>`) de volta pra um
/// item de captura de verdade — compartilhado entre `start_capture` (stream
/// contínuo) e `capture_thumbnail` (um frame só, pro seletor da issue #18).
fn resolve_item(source_id: &str) -> Result<GraphicsCaptureItemType, String> {
    if let Some(index_str) = source_id.strip_prefix("monitor:") {
        let index: usize = index_str.parse().map_err(|_| "capture-source-not-found".to_string())?;
        let monitor = Monitor::from_index(index).map_err(|error| {
            eprintln!("[capture] Monitor::from_index({index}) falhou: {error:?}");
            "capture-source-not-found".to_string()
        })?;
        return monitor.try_into().map_err(|error| {
            eprintln!("[capture] Monitor -> GraphicsCaptureItemType falhou pro indice {index}: {error:?}");
            "capture-source-not-found".to_string()
        });
    }
    if let Some(hwnd_str) = source_id.strip_prefix("window:") {
        let hwnd: isize = hwnd_str.parse().map_err(|_| "capture-source-not-found".to_string())?;
        let window = Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void);
        if !window.is_valid() {
            eprintln!("[capture] Window::is_valid() = false pro hwnd {hwnd}");
            return Err("capture-source-not-found".into());
        }
        return window.try_into().map_err(|error| {
            eprintln!("[capture] Window -> GraphicsCaptureItemType falhou pro hwnd {hwnd}: {error:?}");
            "capture-source-not-found".to_string()
        });
    }
    Err("capture-source-not-found".into())
}

/// Fonte de captura enumerada (issue #8/#18) — id opaco (`monitor:<indice>` ou
/// `window:<hwnd>`) que o cliente devolve intacto em `start_capture`. Nunca
/// exposto como mock: sempre reflete `Monitor::enumerate()`/`Window::enumerate()`
/// de verdade no momento da chamada.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    id: String,
    label: String,
    kind: &'static str,
}

#[tauri::command]
pub fn list_capture_sources() -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::new();

    for monitor in Monitor::enumerate().map_err(|_| "capture-enumerate-failed")? {
        let index = monitor.index().map_err(|_| "capture-enumerate-failed")?;
        let label = monitor
            .name()
            .unwrap_or_else(|_| format!("Monitor {index}"));
        sources.push(CaptureSource { id: format!("monitor:{index}"), label, kind: "monitor" });
    }

    for window in Window::enumerate().map_err(|_| "capture-enumerate-failed")? {
        if !window.is_valid() {
            continue;
        }
        if is_cloaked(window.as_raw_hwnd()) {
            continue;
        }
        let Ok(title) = window.title() else { continue };
        if title.trim().is_empty() {
            continue;
        }
        sources.push(CaptureSource { id: format!("window:{}", window.as_raw_hwnd() as isize), label: title, kind: "window" });
    }

    Ok(sources)
}

/// Preset de qualidade (issue #8) — controla a altura-alvo do frame (downscale
/// antes de codificar) e a qualidade do JPEG. `Auto` nao redimensiona.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Auto,
    Hd720,
    Hd1080,
}

impl Quality {
    fn target_height(self) -> Option<u32> {
        match self {
            Quality::Auto => None,
            Quality::Hd720 => Some(720),
            Quality::Hd1080 => Some(1080),
        }
    }

    fn jpeg_quality(self) -> u8 {
        match self {
            Quality::Auto => 70,
            Quality::Hd720 => 65,
            Quality::Hd1080 => 75,
        }
    }
}

/// Fps pedido pelo cliente pro fluxo de captura — controla o intervalo
/// minimo entre frames que o WGC entrega (`MinimumUpdateIntervalSettings`),
/// nao so a cadencia do `<video>` no frontend (issue #8, pedido do usuario:
/// "tem como definir fps"). Faixa clampada (5-60) pra nunca virar um valor
/// absurdo vindo do cliente (0 causaria divisao por zero no `Duration`).
fn clamp_fps(fps: u32) -> u32 {
    fps.clamp(5, 60)
}

/// Versão pura (testável sem tocar WinRT) de `update_interval_for_fps` —
/// `supported` vem de `is_minimum_update_interval_supported_cached()` no
/// caminho real, ou de um valor fixo no teste.
fn update_interval_for_fps_with_support(fps: u32, supported: bool) -> MinimumUpdateIntervalSettings {
    if !supported {
        return MinimumUpdateIntervalSettings::Default;
    }
    MinimumUpdateIntervalSettings::Custom(Duration::from_secs_f64(1.0 / clamp_fps(fps) as f64))
}

/// Achado real (relatado pelo Victor de novo, depois do fix da borda:
/// `GraphicsCaptureApiError(MinimumUpdateIntervalUnsupported)`) — exatamente
/// a mesma causa do `draw_border_settings` abaixo, só que pra
/// `MinimumUpdateIntervalSettings`: pedir `Custom` incondicionalmente falha
/// em qualquer sistema onde a API de captura não suporta configurar o
/// intervalo mínimo entre frames (`is_minimum_update_interval_supported()`).
/// Sem suporte, cai pra `Default` (cadência nativa do WGC, normalmente a
/// taxa de atualização da tela) em vez de nunca conseguir iniciar a
/// captura — o fps pedido pelo cliente vira só uma preferência, não uma
/// garantia, nesses sistemas. Checagem cacheada pelo mesmo motivo do
/// `draw_border_settings`.
fn is_minimum_update_interval_supported_cached() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or_else(|error| {
            eprintln!("[capture] is_minimum_update_interval_supported falhou, assumindo sem suporte: {error:?}");
            false
        })
    })
}

fn update_interval_for_fps(fps: u32) -> MinimumUpdateIntervalSettings {
    update_interval_for_fps_with_support(fps, is_minimum_update_interval_supported_cached())
}

/// Achado real (relatado pelo Victor, `GraphicsCaptureApiError(BorderConfigUnsupported)`):
/// pedir `WithoutBorder` incondicionalmente falha em qualquer sistema onde a
/// API de captura não suporta trocar a configuração da borda amarela do WGC
/// — o próprio crate documenta isso via `is_border_settings_supported()`.
/// `Default` nunca falha por esse motivo (só entra nesse erro quando o valor
/// pedido é diferente de `Default` e o suporte não existe). Checagem cacheada
/// (`OnceLock`) porque é fixa pra uma instalação do Windows — não faz
/// sentido reconsultar a cada `start_capture`/`capture_thumbnail`.
fn draw_border_settings() -> DrawBorderSettings {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    let supported = *SUPPORTED.get_or_init(|| {
        GraphicsCaptureApi::is_border_settings_supported().unwrap_or_else(|error| {
            eprintln!("[capture] is_border_settings_supported falhou, assumindo sem suporte: {error:?}");
            false
        })
    });
    if supported { DrawBorderSettings::WithoutBorder } else { DrawBorderSettings::Default }
}

/// `as_raw_buffer` do `windows-capture` pode incluir padding por linha
/// (`row_pitch` maior que `width * 4`, comum quando a largura nao e multipla
/// de 256 bytes) — remonta um buffer RGBA compacto (sem padding), o formato
/// que `ImageBuffer::from_raw` exige. Extraida como funcao pura (sem
/// `FrameBuffer` real) pra dar pra testar o recorte de linha sem hardware.
fn strip_row_padding(raw: &[u8], width: u32, height: u32, row_pitch: u32) -> Vec<u8> {
    let expected_row = (width * 4) as usize;
    let mut packed = Vec::with_capacity(expected_row * height as usize);
    for row in 0..height as usize {
        let start = row * row_pitch as usize;
        let end = start + expected_row;
        let Some(slice) = raw.get(start..end) else { break };
        packed.extend_from_slice(slice);
    }
    packed
}

/// Converte um `Frame` cru em JPEG base64, com downscale opcional por altura
/// alvo — usado tanto pelo stream contínuo (`ScreenCapture`) quanto pela
/// miniatura de um frame só (`ThumbnailCapture`, issue #18).
fn frame_to_jpeg_base64(frame: &mut Frame, target_height: Option<u32>, jpeg_quality: u8) -> Result<String, String> {
    let mut buffer = frame.buffer().map_err(|error| {
        eprintln!("[capture] frame.buffer() falhou: {error:?}");
        error.to_string()
    })?;
    let width = buffer.width();
    let height = buffer.height();
    let row_pitch = buffer.row_pitch();
    let raw = buffer.as_raw_buffer();

    let packed = strip_row_padding(raw, width, height, row_pitch);
    let packed_len = packed.len();
    let Some(image) = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, packed) else {
        eprintln!("[capture] ImageBuffer::from_raw falhou: width={width} height={height} row_pitch={row_pitch} packed_len={packed_len}");
        return Err("capture-frame-decode-failed".into());
    };

    let resized = match target_height {
        Some(target) if target < height => {
            let target_width = ((width as u64 * target as u64) / height as u64) as u32;
            image::imageops::resize(&image, target_width.max(1), target, image::imageops::FilterType::Triangle)
        }
        _ => image,
    };

    // JPEG nao suporta canal alfa (achado real via teste isolado —
    // `JpegEncoder::encode` com `ColorType::Rgba8` sempre falhava com
    // `Unsupported(Color(Rgba8))`, silenciosamente: era exatamente aqui que
    // todo frame morria, nunca chegando a emitir nada pro frontend). O
    // buffer capturado (WGC) sempre vem com 4 canais mesmo pra conteudo
    // opaco — descarta o alfa (`into_rgb8`) antes de codificar.
    let rgb = image::DynamicImage::ImageRgba8(resized).into_rgb8();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, jpeg_quality)
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), ColorType::Rgb8.into())
        .map_err(|error| {
            eprintln!("[capture] JpegEncoder::encode falhou: {error:?}");
            error.to_string()
        })?;
    Ok(BASE64.encode(&jpeg))
}

pub struct CaptureFlags {
    app: AppHandle,
    quality: Quality,
}

pub struct ScreenCapture {
    app: AppHandle,
    quality: Quality,
    frame_count: u64,
}

impl GraphicsCaptureApiHandler for ScreenCapture {
    type Flags = CaptureFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        eprintln!("[capture] sessao de captura iniciada de verdade");
        Ok(Self { app: ctx.flags.app, quality: ctx.flags.quality, frame_count: 0 })
    }

    /// Nunca grava frame em disco nem loga o conteudo da tela (issue #23: log de
    /// captura so registra metadados como dimensao/tamanho, nunca pixels) — so
    /// codifica em JPEG e emite pro frontend, que desenha num canvas oculto e
    /// gera o `MediaStream` real via `canvas.captureStream()`.
    fn on_frame_arrived(&mut self, frame: &mut Frame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        self.frame_count += 1;
        // Diagnostico temporario (issue #8: "tela fica cinza") — so os 3
        // primeiros frames e depois 1 a cada 60, nunca o conteudo em si.
        if self.frame_count <= 3 || self.frame_count % 60 == 0 {
            eprintln!(
                "[capture] frame #{} chegou: {}x{}",
                self.frame_count,
                frame.width(),
                frame.height()
            );
        }
        let payload = frame_to_jpeg_base64(frame, self.quality.target_height(), self.quality.jpeg_quality())?;
        if self.frame_count <= 3 {
            eprintln!("[capture] frame #{} codificado em jpeg, {} bytes base64", self.frame_count, payload.len());
        }
        if let Err(error) = self.app.emit("capture-frame", payload) {
            eprintln!("[capture] emit(capture-frame) falhou: {error:?}");
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        eprintln!("[capture] sessao encerrada apos {} frame(s)", self.frame_count);
        let _ = self.app.emit("capture-ended", ());
        Ok(())
    }
}

type RunningCapture = CaptureControl<ScreenCapture, String>;
static RUNNING: OnceLock<Mutex<Option<RunningCapture>>> = OnceLock::new();

// `.lock()` recupera de "poison" (`unwrap_or_else(|poisoned| poisoned.into_inner())`
// em vez de `.unwrap()`) em vez de propagar o panic: um panic acidental
// segurando este lock nunca deveria travar TODO comando de captura futuro
// (exigindo reiniciar o app inteiro) só porque o `Mutex` ficou marcado como
// envenenado — o estado dentro dele continua utilizável.
fn running() -> &'static Mutex<Option<RunningCapture>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// Achado real (Visualizador de Eventos do Windows, "Application Hang" /
/// "Tipo com falha: Cross-thread" — confirmado em 4 ocorrências distintas,
/// versões 2.0.4, 2.0.5 e 2.0.7, sempre no mesmo tipo): comandos Tauri
/// síncronos (sem `async`) rodam na THREAD PRINCIPAL por padrão (mesma
/// thread que o WebView2 inicializou em modo STA). `start_capture_blocking`
/// (abaixo) bloqueia essa mesma chamada em `run_on_fresh_thread`
/// (`std::thread::spawn(...).join()`) até a captura WGC abrir de verdade —
/// se, nesse meio-tempo, a thread nova precisar marshalar de volta uma
/// chamada WinRT/COM pro apartamento STA da thread principal (comum em
/// interop WinRT), e a thread principal está parada em `.join()` sem
/// bombear sua fila de mensagens, as duas travam esperando uma a outra:
/// exatamente o padrão "Cross-thread" registrado. Mesma causa raiz e mesma
/// correção já usada em `desktop_auth::desktop_oauth_login` — mover o
/// trabalho bloqueante pra fora da thread principal via
/// `tauri::async_runtime::spawn_blocking`, mantendo o corpo em si
/// inalterado.
#[tauri::command]
pub async fn start_capture(app: AppHandle, source_id: String, quality: Quality, fps: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || start_capture_blocking(app, source_id, quality, fps))
        .await
        .map_err(|_| "capture-thread-panic".to_string())?
}

fn start_capture_blocking(app: AppHandle, source_id: String, quality: Quality, fps: u32) -> Result<(), String> {
    {
        let guard = running().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_some() {
            return Err("capture-already-running".into());
        }
    }
    let update_interval = update_interval_for_fps(fps);

    // `start_free_threaded` exige `T: Send` (o item cruza pra uma thread nova
    // que ele mesmo cria) — `GraphicsCaptureItemType` (o enum unificado de
    // `resolve_item`) carrega um `HwndGuard`/`HWND` cru que NÃO é `Send`, só
    // por causa da variante `Unknown` do seletor nativo (que nunca usamos
    // aqui). Por isso este comando resolve pro tipo concreto (`Monitor` ou
    // `Window`, que são `Send`) em vez de reusar `resolve_item`. Tudo roda
    // dentro de `run_on_fresh_thread` (ver comentário acima) por causa do
    // `FailedToInitWinRT`.
    let control = run_on_fresh_thread(move || -> Result<RunningCapture, String> {
        if let Some(index_str) = source_id.strip_prefix("monitor:") {
            let index: usize = index_str.parse().map_err(|_| "capture-source-not-found".to_string())?;
            let monitor = Monitor::from_index(index).map_err(|_| "capture-source-not-found".to_string())?;
            let settings = Settings::new(
                monitor,
                CursorCaptureSettings::Default,
                draw_border_settings(),
                SecondaryWindowSettings::Default,
                update_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                CaptureFlags { app: app.clone(), quality },
            );
            ScreenCapture::start_free_threaded(settings).map_err(|error| {
                eprintln!("[capture] start_free_threaded (monitor) falhou: {error:?}");
                // O detalhe vai junto do código (separado por ":"), não só no
                // eprintln! — em build de release (`windows_subsystem =
                // "windows"`) o stderr não tem console nenhum pra aparecer,
                // então sem isso o motivo real do erro fica invisível pra
                // sempre pra quem não builda em modo debug. `captureClient.ts`
                // sabe separar o código do detalhe.
                format!("capture-start-failed:{error:?}")
            })
        } else if let Some(hwnd_str) = source_id.strip_prefix("window:") {
            let hwnd: isize = hwnd_str.parse().map_err(|_| "capture-source-not-found".to_string())?;
            let window = Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void);
            if !window.is_valid() {
                return Err("capture-source-not-found".into());
            }
            let settings = Settings::new(
                window,
                CursorCaptureSettings::Default,
                draw_border_settings(),
                SecondaryWindowSettings::Default,
                update_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                CaptureFlags { app: app.clone(), quality },
            );
            ScreenCapture::start_free_threaded(settings).map_err(|error| {
                eprintln!("[capture] start_free_threaded (window) falhou: {error:?}");
                format!("capture-start-failed:{error:?}")
            })
        } else {
            Err("capture-source-not-found".into())
        }
    })??;

    *running().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(control);
    Ok(())
}

/// Miniatura de um frame só (issue #18: seletor com cara de grid, tipo
/// Discord, em vez do diálogo nativo) — abre uma sessão WGC igual à captura
/// de verdade, mas para sozinha assim que o primeiro frame chega. Sempre em
/// baixa resolução (240px de largura) e qualidade JPEG baixa: é só pra
/// preview do seletor, não pro compartilhamento em si.
struct ThumbnailFlags {
    tx: mpsc::Sender<Result<String, String>>,
}

struct ThumbnailCapture {
    tx: mpsc::Sender<Result<String, String>>,
}

impl GraphicsCaptureApiHandler for ThumbnailCapture {
    type Flags = ThumbnailFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { tx: ctx.flags.tx })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        let result = frame_to_jpeg_base64(frame, Some(240), 60);
        let _ = self.tx.send(result);
        control.stop();
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// Mesmo risco de "Cross-thread" hang documentado em `start_capture` —
/// também usa `run_on_fresh_thread` (bloqueia esperando a miniatura),
/// também precisa sair da thread principal.
#[tauri::command]
pub async fn capture_thumbnail(source_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capture_thumbnail_blocking(source_id))
        .await
        .map_err(|_| "capture-thread-panic".to_string())?
}

fn capture_thumbnail_blocking(source_id: String) -> Result<String, String> {
    // `run_on_fresh_thread` (ver comentário acima, `FailedToInitWinRT`): o
    // `resolve_item` (`.try_into()` pra `GraphicsCaptureItemType`) e o
    // `ThumbnailCapture::start` de baixo tocam WinRT e precisam de uma
    // thread sem COM inicializado ainda — a que o Tauri entrega esse
    // comando já está em modo STA (WebView2).
    run_on_fresh_thread(move || -> Result<String, String> {
        let item = resolve_item(&source_id)?;
        let (tx, rx) = mpsc::channel();
        let settings = Settings::new(
            item,
            CursorCaptureSettings::Default,
            draw_border_settings(),
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            ThumbnailFlags { tx },
        );
        // `start` (nao `start_free_threaded`) de proposito: bloqueia esta
        // thread (que já é a thread nova de `run_on_fresh_thread`, não a
        // do Tauri) até o handler chamar `control.stop()` no primeiro frame.
        ThumbnailCapture::start(settings).map_err(|error| {
            eprintln!("[capture] miniatura (start) falhou: {error:?}");
            "capture-thumbnail-failed".to_string()
        })?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|error| {
                eprintln!("[capture] miniatura: nenhum frame chegou a tempo: {error:?}");
                "capture-thumbnail-timeout".to_string()
            })?
    })?
}

/// Mesma cautela do `start_capture`/`capture_thumbnail`: `control.stop()`
/// (abaixo) pode esperar a sessão WGC encerrar de verdade do lado da API
/// de captura — mesmo risco de precisar da thread principal livre pra
/// marshalar WinRT/COM enquanto espera. Sai da thread principal pelo mesmo
/// motivo, mesmo sem uma reprodução isolada confirmando este comando
/// específico como o gatilho de algum "Cross-thread" já registrado.
#[tauri::command]
pub async fn stop_capture() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(stop_capture_blocking)
        .await
        .map_err(|_| "capture-thread-panic".to_string())?
}

fn stop_capture_blocking() -> Result<(), String> {
    let control = running().lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
    match control {
        Some(control) => control.stop().map_err(|error| error.to_string()),
        // Nao ha captura em andamento — idempotente, nao e erro (espelha o
        // `desktop_auth::desktop_oauth_cancel`, que tambem e um no-op seguro).
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_fps_keeps_reasonable_values_and_bounds_the_rest() {
        assert_eq!(clamp_fps(30), 30);
        assert_eq!(clamp_fps(0), 5); // 0 causaria divisao por zero no Duration
        assert_eq!(clamp_fps(1000), 60);
    }

    #[test]
    fn update_interval_for_fps_matches_the_requested_cadence_when_supported() {
        let MinimumUpdateIntervalSettings::Custom(interval) = update_interval_for_fps_with_support(30, true) else {
            panic!("esperava MinimumUpdateIntervalSettings::Custom");
        };
        assert!((interval.as_secs_f64() - 1.0 / 30.0).abs() < 1e-9);
    }

    /// Regressao (Victor, `GraphicsCaptureApiError(MinimumUpdateIntervalUnsupported)`)
    /// — sem suporte, cai pra `Default` em vez de continuar pedindo `Custom`
    /// (o que faria `start_capture` falhar de novo na mesma maquina).
    #[test]
    fn update_interval_for_fps_falls_back_to_default_when_unsupported() {
        assert_eq!(update_interval_for_fps_with_support(30, false), MinimumUpdateIntervalSettings::Default);
    }

    #[test]
    fn quality_presets_have_the_expected_target_height() {
        assert_eq!(Quality::Auto.target_height(), None);
        assert_eq!(Quality::Hd720.target_height(), Some(720));
        assert_eq!(Quality::Hd1080.target_height(), Some(1080));
    }

    #[test]
    fn strip_row_padding_removes_padding_bytes_between_rows() {
        // 2x2 RGBA, mas cada linha tem 4 bytes de padding depois dos 8 de
        // verdade (row_pitch=12, largura*4=8) — simula o caso comum de
        // `windows-capture` alinhar cada linha a um multiplo de 256 bytes.
        let row0 = [1, 1, 1, 1, 2, 2, 2, 2, 9, 9, 9, 9]; // 9,9,9,9 = padding
        let row1 = [3, 3, 3, 3, 4, 4, 4, 4, 9, 9, 9, 9];
        let raw = [row0, row1].concat();

        let packed = strip_row_padding(&raw, 2, 2, 12);

        assert_eq!(packed, vec![1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
    }

    #[test]
    fn strip_row_padding_with_no_padding_is_a_straight_copy() {
        let raw: Vec<u8> = (0..16).collect(); // 2x2 RGBA, row_pitch == width*4
        let packed = strip_row_padding(&raw, 2, 2, 8);
        assert_eq!(packed, raw);
    }

    #[test]
    fn strip_row_padding_stops_early_instead_of_panicking_on_a_truncated_buffer() {
        let raw = [0u8; 4]; // bem menor que o esperado pra 2x2 RGBA
        let packed = strip_row_padding(&raw, 2, 2, 8);
        assert!(packed.len() < 16, "deveria parar cedo em vez de tentar ler fora do buffer");
    }

    /// Regressao (issue #8) — `JpegEncoder::encode` rejeita `ColorType::Rgba8`
    /// (`Unsupported(Color(Rgba8))`); todo frame de verdade (buffer WGC
    /// sempre vem com 4 canais, mesmo pra conteudo opaco) morria silenciosamente
    /// nesse ponto exato ate `frame_to_jpeg_base64` passar a descartar o alfa
    /// (`into_rgb8()`) antes de codificar. `Frame` do `windows-capture` nao da
    /// pra construir fora de uma sessao de captura real, entao este teste
    /// replica só o resize+encode com as mesmas dimensoes de um frame real.
    #[test]
    fn resize_then_jpeg_encode_succeeds_on_an_rgba_buffer_like_a_real_frame() {
        let width = 1920u32;
        let height = 1032u32;
        let pixels = vec![128u8; (width * height * 4) as usize];
        let image = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, pixels).unwrap();
        let resized = image::imageops::resize(&image, 446, 240, image::imageops::FilterType::Triangle);
        let rgb = image::DynamicImage::ImageRgba8(resized).into_rgb8();

        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 60)
            .encode(rgb.as_raw(), rgb.width(), rgb.height(), ColorType::Rgb8.into())
            .expect("encode deveria ter sucesso depois de descartar o canal alfa");
        assert!(!jpeg.is_empty());
    }
}
