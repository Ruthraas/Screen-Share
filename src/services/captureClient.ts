import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Cliente fino pros comandos Rust de captura nativa (issue #8,
 * `src-tauri/src/capture.rs`) — captura 100% via Windows Graphics Capture,
 * nunca `getDisplayMedia`/API de navegador (decisão explícita do produto).
 * Fora do Tauri (dev em navegador puro), toda função aqui lança —
 * consistente com o resto do app, que só roda de verdade dentro do Tauri.
 */
export type CaptureSourceKind = "monitor" | "window";
export type CaptureSource = { id: string; label: string; kind: CaptureSourceKind };
export type CaptureQuality = "auto" | "hd720" | "hd1080";
export type CaptureFps = 15 | 30 | 60;

function assertTauri(): void {
  if (!isTauri()) throw new Error("captura so funciona dentro do aplicativo desktop");
}

/** Códigos que `src-tauri/src/capture.rs`/`audio.rs` devolvem via `Err(String)`
 * — o Tauri rejeita a promise do `invoke` com essa string CRUA (não um
 * `Error`), então `error instanceof Error` é sempre falso pra esses casos;
 * quem trata o erro precisa passar pela extração abaixo, não só checar
 * `instanceof Error`, senão perde o código real e cai num fallback genérico. */
const CAPTURE_ERROR_MESSAGES: Record<string, string> = {
  "capture-enumerate-failed": "nao foi possivel listar telas/janelas",
  "capture-source-not-found": "essa fonte nao esta mais disponivel, tente escolher de novo",
  "capture-already-running": "ja existe uma captura em andamento",
  "capture-start-failed": "nao foi possivel iniciar a captura dessa fonte",
  "capture-thumbnail-failed": "nao foi possivel gerar a previa dessa fonte",
  "capture-thumbnail-timeout": "a previa demorou demais pra responder",
  "capture-thread-panic": "falha interna ao iniciar a captura",
  "capture-frame-decode-failed": "falha ao decodificar um frame capturado",
  "audio-already-running": "o audio do sistema ja esta sendo capturado",
};

/** Extrai uma mensagem legivel de qualquer coisa que um `invoke()` rejeitado
 * possa lançar: um `Error` de verdade, ou — o caso comum aqui, já que os
 * comandos Rust devolvem `Err(String)` — a string crua do código. */
export function captureErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (!code) return "nao foi possivel completar a operacao de captura";
  return CAPTURE_ERROR_MESSAGES[code] ?? `nao foi possivel completar a operacao de captura (${code})`;
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  assertTauri();
  return invoke<CaptureSource[]>("list_capture_sources");
}

export async function startCapture(sourceId: string, quality: CaptureQuality, fps: CaptureFps): Promise<void> {
  assertTauri();
  await invoke("start_capture", { sourceId, quality, fps });
}

export async function stopCapture(): Promise<void> {
  assertTauri();
  await invoke("stop_capture");
}

/** Miniatura (base64 JPEG) de uma fonte, pro seletor com grid de cards
 * (issue #18) — um frame só, baixa resolução, nunca o stream de verdade. */
export async function captureThumbnail(sourceId: string): Promise<string> {
  assertTauri();
  return invoke<string>("capture_thumbnail", { sourceId });
}

/** Um frame JPEG (base64) por evento — `src-tauri/src/capture.rs` nunca
 * grava nem loga o conteúdo, só emite pra cá. */
export function onCaptureFrame(handler: (base64Jpeg: string) => void): Promise<UnlistenFn> {
  return listen<string>("capture-frame", event => handler(event.payload));
}

/** Disparado pelo lado Rust quando a captura termina sozinha (ex.: janela
 * capturada foi fechada) — não é o mesmo que `stopCapture()` ser chamado
 * pelo usuário, então quem consome isso deve tratar como "encerrado
 * inesperadamente", igual ao `onStreamEnded` do `ScreenViewer`. */
export function onCaptureEnded(handler: () => void): Promise<UnlistenFn> {
  return listen<null>("capture-ended", () => handler());
}

/**
 * Áudio do sistema (loopback), nunca microfone — decisão de produto de
 * 2026-09-13. `src-tauri/src/audio.rs` é independente da captura de vídeo
 * (comandos/eventos próprios), então dá pra ligar/desligar sem afetar o
 * vídeo — falha de áudio não deve derrubar a captura de tela.
 */
export type AudioFormat = { sampleRate: number; channels: number; bitsPerSample: number; float: boolean };

export async function startSystemAudioCapture(): Promise<void> {
  assertTauri();
  await invoke("start_system_audio_capture");
}

export async function stopSystemAudioCapture(): Promise<void> {
  assertTauri();
  await invoke("stop_system_audio_capture");
}

export function onAudioFormat(handler: (format: AudioFormat) => void): Promise<UnlistenFn> {
  return listen<AudioFormat>("capture-audio-format", event => handler(event.payload));
}

export function onAudioChunk(handler: (base64Pcm: string) => void): Promise<UnlistenFn> {
  return listen<string>("capture-audio", event => handler(event.payload));
}

export function onAudioError(handler: (code: string) => void): Promise<UnlistenFn> {
  return listen<string>("capture-audio-error", event => handler(event.payload));
}
