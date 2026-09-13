use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, ImageBuffer, Rgba};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

/// Resolve o id opaco (`monitor:<indice>` ou `window:<hwnd>`) de volta pra um
/// item de captura de verdade — compartilhado entre `start_capture` (stream
/// contínuo) e `capture_thumbnail` (um frame só, pro seletor da issue #18).
fn resolve_item(source_id: &str) -> Result<GraphicsCaptureItemType, String> {
    if let Some(index_str) = source_id.strip_prefix("monitor:") {
        let index: usize = index_str.parse().map_err(|_| "capture-source-not-found".to_string())?;
        let monitor = Monitor::from_index(index).map_err(|_| "capture-source-not-found".to_string())?;
        return monitor.try_into().map_err(|_| "capture-source-not-found".to_string());
    }
    if let Some(hwnd_str) = source_id.strip_prefix("window:") {
        let hwnd: isize = hwnd_str.parse().map_err(|_| "capture-source-not-found".to_string())?;
        let window = Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void);
        if !window.is_valid() {
            return Err("capture-source-not-found".into());
        }
        return window.try_into().map_err(|_| "capture-source-not-found".to_string());
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
    let mut buffer = frame.buffer().map_err(|error| error.to_string())?;
    let width = buffer.width();
    let height = buffer.height();
    let row_pitch = buffer.row_pitch();
    let raw = buffer.as_raw_buffer();

    let packed = strip_row_padding(raw, width, height, row_pitch);
    let Some(image) = ImageBuffer::<Rgba<u8>, _>::from_raw(width, height, packed) else {
        return Err("capture-frame-decode-failed".into());
    };

    let resized = match target_height {
        Some(target) if target < height => {
            let target_width = ((width as u64 * target as u64) / height as u64) as u32;
            image::imageops::resize(&image, target_width.max(1), target, image::imageops::FilterType::Triangle)
        }
        _ => image,
    };

    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, jpeg_quality)
        .encode(resized.as_raw(), resized.width(), resized.height(), ColorType::Rgba8.into())
        .map_err(|error| error.to_string())?;
    Ok(BASE64.encode(&jpeg))
}

pub struct CaptureFlags {
    app: AppHandle,
    quality: Quality,
}

pub struct ScreenCapture {
    app: AppHandle,
    quality: Quality,
}

impl GraphicsCaptureApiHandler for ScreenCapture {
    type Flags = CaptureFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { app: ctx.flags.app, quality: ctx.flags.quality })
    }

    /// Nunca grava frame em disco nem loga o conteudo da tela (issue #23: log de
    /// captura so registra metadados como dimensao/tamanho, nunca pixels) — so
    /// codifica em JPEG e emite pro frontend, que desenha num canvas oculto e
    /// gera o `MediaStream` real via `canvas.captureStream()`.
    fn on_frame_arrived(&mut self, frame: &mut Frame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        let payload = frame_to_jpeg_base64(frame, self.quality.target_height(), self.quality.jpeg_quality())?;
        let _ = self.app.emit("capture-frame", payload);
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        let _ = self.app.emit("capture-ended", ());
        Ok(())
    }
}

type RunningCapture = CaptureControl<ScreenCapture, String>;
static RUNNING: OnceLock<Mutex<Option<RunningCapture>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<RunningCapture>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub fn start_capture(app: AppHandle, source_id: String, quality: Quality) -> Result<(), String> {
    {
        let guard = running().lock().unwrap();
        if guard.is_some() {
            return Err("capture-already-running".into());
        }
    }

    // `start_free_threaded` exige `T: Send` (o item cruza pra uma thread nova
    // que ele mesmo cria) — `GraphicsCaptureItemType` (o enum unificado de
    // `resolve_item`) carrega um `HwndGuard`/`HWND` cru que NÃO é `Send`, só
    // por causa da variante `Unknown` do seletor nativo (que nunca usamos
    // aqui). Por isso este comando resolve pro tipo concreto (`Monitor` ou
    // `Window`, que são `Send`) em vez de reusar `resolve_item` — diferente
    // de `capture_thumbnail`, que usa `start()` (bloqueante, sem essa
    // exigência) e pode reusar o enum unificado sem problema.
    let control = if let Some(index_str) = source_id.strip_prefix("monitor:") {
        let index: usize = index_str.parse().map_err(|_| "capture-source-not-found")?;
        let monitor = Monitor::from_index(index).map_err(|_| "capture-source-not-found")?;
        let settings = Settings::new(
            monitor,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            CaptureFlags { app: app.clone(), quality },
        );
        ScreenCapture::start_free_threaded(settings).map_err(|_| "capture-start-failed".to_string())?
    } else if let Some(hwnd_str) = source_id.strip_prefix("window:") {
        let hwnd: isize = hwnd_str.parse().map_err(|_| "capture-source-not-found")?;
        let window = Window::from_raw_hwnd(hwnd as *mut std::ffi::c_void);
        if !window.is_valid() {
            return Err("capture-source-not-found".into());
        }
        let settings = Settings::new(
            window,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            CaptureFlags { app: app.clone(), quality },
        );
        ScreenCapture::start_free_threaded(settings).map_err(|_| "capture-start-failed".to_string())?
    } else {
        return Err("capture-source-not-found".into());
    };

    *running().lock().unwrap() = Some(control);
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

#[tauri::command]
pub fn capture_thumbnail(source_id: String) -> Result<String, String> {
    let item = resolve_item(&source_id)?;
    let (tx, rx) = mpsc::channel();
    let settings = Settings::new(
        item,
        CursorCaptureSettings::Default,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        ThumbnailFlags { tx },
    );
    // `start` (nao `start_free_threaded`) de proposito: bloqueia a thread
    // deste comando ate o handler chamar `control.stop()` no primeiro
    // frame — o comando Tauri ja roda numa thread do pool do runtime, nao
    // trava a UI (que so aguarda a promise resolver do lado do frontend).
    ThumbnailCapture::start(settings).map_err(|_| "capture-thumbnail-failed".to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "capture-thumbnail-timeout".to_string())?
}

#[tauri::command]
pub fn stop_capture() -> Result<(), String> {
    let control = running().lock().unwrap().take();
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
}
