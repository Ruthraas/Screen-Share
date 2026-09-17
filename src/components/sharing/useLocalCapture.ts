import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "../../services/logger";
import {
  captureErrorMessage,
  onAudioChunk,
  onAudioError,
  onAudioFormat,
  onCaptureEnded,
  onCaptureFrame,
  startCapture,
  startSystemAudioCapture,
  stopCapture,
  stopSystemAudioCapture,
  type AudioFormat,
  type CaptureFps,
  type CaptureQuality,
} from "../../services/captureClient";
import { base64ToBytes, decodeInterleavedPcm } from "./pcmAudio";
import { setLocalStream, setSharingActive } from "../../services/sharingState";

export type LocalCaptureStatus = "idle" | "starting" | "active" | "error";

/** Prazo máximo pra esperar o PRIMEIRO frame de verdade depois de
 * `start_capture` retornar sucesso — o comando Rust só confirma que a sessão
 * WGC abriu, não que ela vai de fato entregar frames (achado real: numa
 * máquina especifica, GPU/driver pode aceitar a sessão e nunca chamar
 * `on_frame_arrived`, sem nenhum erro voltando pro lado do cliente). Sem
 * isso, `hasFrame` nunca vira `true` e a UI (`ScreenViewer`, `loading`) fica
 * em "carregando tela" pra sempre, sem jeito de perceber que travou. */
const FIRST_FRAME_TIMEOUT_MS = 12_000;

function base64JpegToBlob(base64: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: "image/jpeg" });
}

/** Confirmação sonora de que a transmissão começou — pedido do usuário.
 * Duas notas curtas sintetizadas na hora (sem precisar de nenhum arquivo de
 * áudio embutido). Nunca deve derrubar a captura se o Web Audio falhar por
 * algum motivo (autoplay policy, por exemplo) — só não toca o som. */
function playStartChime(): void {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    const notes = [523.25, 659.25]; // C5, E5 — soa como uma confirmação, nao um alarme
    for (const [index, frequency] of notes.entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const startAt = now + index * 0.11;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.15, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.2);
    }
    setTimeout(() => { context.close().catch(() => {}); }, 500);
  } catch {
    // Web Audio indisponivel — silencioso, nao deve travar a captura.
  }
}

/**
 * Ponte entre a captura nativa (issue #8, `src-tauri/src/capture.rs`, frames
 * JPEG via evento Tauri) e o `MediaStream` real que `ScreenViewer` já sabe
 * consumir: desenha cada frame recebido num `<canvas>` fora do DOM e usa
 * `canvas.captureStream()` — a mesma técnica já validada no
 * `test-harness/screen-viewer.tsx` (issue #26), só que alimentada por
 * captura de tela de verdade em vez de `canvas.captureStream(0)` estático.
 *
 * Descarta frames em atraso em vez de enfileirar (`decodingRef`): sempre
 * desenha o frame mais recente disponível, nunca acumula atraso.
 *
 * Áudio do sistema (opcional, decisão de produto de 2026-09-13, nunca
 * microfone) segue o mesmo princípio via Web Audio API: cada pacote PCM
 * (`src-tauri/src/audio.rs`) vira um `AudioBuffer` agendado de volta a back
 * num `MediaStreamAudioDestinationNode`, cuja track de áudio se junta à
 * track de vídeo do canvas no `MediaStream` final — falha de áudio nunca
 * derruba o vídeo (é sempre tratada como não-fatal).
 */
export function useLocalCapture() {
  const [status, setStatus] = useState<LocalCaptureStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [stream, setStream] = useState<MediaStream | undefined>(undefined);
  // Existe um intervalo real entre `start_capture` responder com sucesso e
  // o primeiro `capture-frame` de verdade chegar — sem isso, a tela fica
  // em branco por um instante e parece travada. `ScreenViewer` usa isso pra
  // mostrar "carregando tela" até o primeiro frame ser desenhado de verdade.
  const [hasFrame, setHasFrame] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decodingRef = useRef(false);
  const unlistenRef = useRef<Array<() => void>>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFormatRef = useRef<AudioFormat | null>(null);
  const nextAudioStartRef = useRef(0);
  const audioEnabledRef = useRef(false);
  const hasFrameRef = useRef(false);
  const frameTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearFrameTimeout = useCallback(() => {
    if (frameTimeoutRef.current !== undefined) {
      clearTimeout(frameTimeoutRef.current);
      frameTimeoutRef.current = undefined;
    }
  }, []);

  const teardown = useCallback(() => {
    clearFrameTimeout();
    hasFrameRef.current = false;
    setSharingActive(false);
    setLocalStream(null);
    setHasFrame(false);
    for (const unlisten of unlistenRef.current) unlisten();
    unlistenRef.current = [];
    setStream(current => {
      current?.getTracks().forEach(track => track.stop());
      return undefined;
    });
    canvasRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    audioFormatRef.current = null;
    if (audioEnabledRef.current) {
      audioEnabledRef.current = false;
      void stopSystemAudioCapture().catch(() => {});
    }
  }, [clearFrameTimeout]);

  const start = useCallback(async (sourceId: string, quality: CaptureQuality, audioEnabled: boolean, fps: CaptureFps = 30) => {
    setStatus("starting");
    setError(undefined);
    hasFrameRef.current = false;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas 2d indisponivel");
      canvasRef.current = canvas;

      const unlistenFrame = await onCaptureFrame(async base64Jpeg => {
        if (decodingRef.current) return; // frame em atraso: descarta, nunca acumula fila
        decodingRef.current = true;
        try {
          const bitmap = await createImageBitmap(base64JpegToBlob(base64Jpeg));
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          if (!hasFrameRef.current) {
            hasFrameRef.current = true;
            clearFrameTimeout();
          }
          setHasFrame(true);
        } catch (frameError) {
          log.warn("capture", "falha ao decodificar frame recebido", {
            name: frameError instanceof Error ? frameError.name : "unknown",
          });
        } finally {
          decodingRef.current = false;
        }
      });
      const unlistenEnded = await onCaptureEnded(() => {
        log.warn("capture", "captura nativa encerrada inesperadamente");
        teardown();
        setStatus("idle");
      });
      const unlisteners = [unlistenFrame, unlistenEnded];

      const videoTracks = canvas.captureStream(fps).getVideoTracks();
      let audioDestination: MediaStreamAudioDestinationNode | null = null;

      if (audioEnabled) {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        audioDestination = audioContext.createMediaStreamDestination();
        nextAudioStartRef.current = 0;

        const unlistenFormat = await onAudioFormat(format => { audioFormatRef.current = format; });
        const unlistenChunk = await onAudioChunk(base64Pcm => {
          const format = audioFormatRef.current;
          const destination = audioDestination;
          if (!format || !destination) return; // ainda nao chegou o formato — descarta o pacote
          try {
            const planar = decodeInterleavedPcm(base64ToBytes(base64Pcm), format);
            const frameCount = planar[0]?.length ?? 0;
            if (frameCount === 0) return;
            const buffer = audioContext.createBuffer(format.channels, frameCount, format.sampleRate);
            planar.forEach((channelData, index) => buffer.copyToChannel(channelData, index));
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(destination);
            const now = audioContext.currentTime;
            const startAt = Math.max(now, nextAudioStartRef.current);
            source.start(startAt);
            nextAudioStartRef.current = startAt + buffer.duration;
          } catch (audioError) {
            log.warn("capture", "falha ao decodificar pacote de audio", {
              name: audioError instanceof Error ? audioError.name : "unknown",
            });
          }
        });
        const unlistenAudioError = await onAudioError(code => {
          // Nao-fatal: continua so com video (issue #8 — audio e opcional).
          log.warn("capture", "captura de audio do sistema falhou, continuando so com video", { code });
        });
        unlisteners.push(unlistenFormat, unlistenChunk, unlistenAudioError);
      }

      unlistenRef.current = unlisteners;

      await startCapture(sourceId, quality, fps);
      // `startCapture` só confirma que a sessão WGC abriu do lado do Rust,
      // nunca que frames de verdade vão chegar (achado real: numa máquina
      // especifica isso pode nunca acontecer, sem nenhum erro). Sem prazo, a
      // UI ficaria em "carregando tela" pra sempre em vez de virar um erro
      // acionável (retry / trocar de fonte).
      clearFrameTimeout();
      frameTimeoutRef.current = setTimeout(() => {
        if (hasFrameRef.current) return;
        log.warn("capture", "nenhum frame chegou a tempo depois de iniciar a captura, desistindo", {
          timeoutMs: FIRST_FRAME_TIMEOUT_MS,
        });
        teardown();
        setStatus("error");
        setError("a captura iniciou mas nenhuma imagem chegou a tempo — tente novamente ou escolha outra fonte");
        void stopCapture().catch(() => {});
      }, FIRST_FRAME_TIMEOUT_MS);
      if (audioEnabled) {
        audioEnabledRef.current = true;
        try {
          await startSystemAudioCapture();
        } catch (audioStartError) {
          // Video ja esta subindo — falha ao iniciar audio nao aborta o fluxo.
          audioEnabledRef.current = false;
          log.warn("capture", "nao foi possivel iniciar audio do sistema, continuando so com video", {
            message: audioStartError instanceof Error ? audioStartError.message : "unknown",
          });
        }
      }

      const combined = new MediaStream([...videoTracks, ...(audioDestination?.stream.getAudioTracks() ?? [])]);
      setStream(combined);
      setStatus("active");
      setSharingActive(true);
      setLocalStream(combined);
      playStartChime();
      log.info("capture", "captura local iniciada", { quality, fps, audio: audioEnabled });
    } catch (startError) {
      teardown();
      setStatus("error");
      const message = captureErrorMessage(startError);
      setError(message);
      log.warn("capture", "falha ao iniciar captura local", { message });
    }
  }, [teardown, clearFrameTimeout]);

  const stop = useCallback(async () => {
    teardown();
    setStatus("idle");
    try {
      await stopCapture();
    } catch (stopError) {
      log.warn("capture", "falha ao parar captura nativa (estado local ja foi limpo)", {
        message: stopError instanceof Error ? stopError.message : "unknown",
      });
    }
  }, [teardown]);

  useEffect(() => () => { teardown(); void stopCapture().catch(() => {}); }, [teardown]);

  return { status, error, stream, hasFrame, start, stop };
}
