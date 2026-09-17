use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use wasapi::{initialize_mta, AudioClient, Direction, SampleType, StreamMode};

/// Captura de áudio do sistema (loopback, issue #8 — decisão de produto
/// 2026-09-13: som do que está tocando, nunca microfone). Usa
/// `AudioClient::new_application_loopback_client(0, true)` — o mesmo
/// mecanismo de "process loopback" do Windows 10 2004+, com `process_id: 0`
/// pra capturar o sistema inteiro (não um processo específico).
static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static THREAD: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();

// Recupera de "poison" em vez de propagar o panic (ver comentario igual em
// capture.rs `running()`) — nunca deveria travar todo comando de audio
// futuro por causa de um panic acidental segurando este lock antes.
fn thread_slot() -> &'static Mutex<Option<JoinHandle<()>>> {
    THREAD.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct AudioFormat {
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    float: bool,
}

fn capture_loop(app: AppHandle) -> Result<(), String> {
    initialize_mta().ok().map_err(|error| error.to_string())?;

    let mut client = AudioClient::new_application_loopback_client(0, true).map_err(|error| error.to_string())?;
    let format = client.get_mixformat().map_err(|error| error.to_string())?;
    let sample_type = format.get_subformat().map_err(|error| error.to_string())?;

    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::PollingShared { autoconvert: true, buffer_duration_hns: 3_000_000 },
        )
        .map_err(|error| error.to_string())?;

    let capture_client = client.get_audiocaptureclient().map_err(|error| error.to_string())?;
    client.start_stream().map_err(|error| error.to_string())?;

    let audio_format = AudioFormat {
        sample_rate: format.get_samplespersec(),
        channels: format.get_nchannels(),
        bits_per_sample: format.get_bitspersample(),
        float: matches!(sample_type, SampleType::Float),
    };
    let _ = app.emit("capture-audio-format", audio_format);

    let mut pending = std::collections::VecDeque::<u8>::new();
    while !STOP.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(20));
        match capture_client.get_next_packet_size() {
            Ok(Some(size)) if size > 0 => {
                if capture_client.read_from_device_to_deque(&mut pending).is_err() {
                    break;
                }
            }
            Ok(_) => continue,
            Err(_) => break,
        }
        // Nunca loga o conteudo do audio (issue #23) — so os bytes vao pro
        // frontend via evento, sem passar por nenhum log.
        if !pending.is_empty() {
            let chunk: Vec<u8> = pending.drain(..).collect();
            let _ = app.emit("capture-audio", BASE64.encode(&chunk));
        }
    }

    let _ = client.stop_stream();
    Ok(())
}

#[tauri::command]
pub fn start_system_audio_capture(app: AppHandle) -> Result<(), String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("audio-already-running".into());
    }
    STOP.store(false, Ordering::SeqCst);

    let handle_app = app.clone();
    let handle = std::thread::spawn(move || {
        if let Err(error) = capture_loop(handle_app.clone()) {
            let _ = handle_app.emit("capture-audio-error", error);
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
    *thread_slot().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_system_audio_capture() -> Result<(), String> {
    STOP.store(true, Ordering::SeqCst);
    if let Some(handle) = thread_slot().lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
        let _ = handle.join();
    }
    Ok(())
}
