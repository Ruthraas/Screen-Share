import type { AudioFormat } from "../../services/captureClient";

/**
 * Decodifica PCM intercalado (formato bruto do WASAPI, `src-tauri/src/audio.rs`)
 * pra um array de canais planos (`Float32Array` por canal) — o formato que
 * `AudioBuffer.copyToChannel` espera. Função pura, sem `AudioContext`, pra
 * dar pra testar sem ambiente de áudio real.
 */
export function decodeInterleavedPcm(bytes: Uint8Array, format: AudioFormat): Float32Array<ArrayBuffer>[] {
  const { channels, bitsPerSample, float } = format;
  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const frameCount = frameSize > 0 ? Math.floor(bytes.length / frameSize) : 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const planar: Float32Array<ArrayBuffer>[] = [];
  for (let channel = 0; channel < channels; channel++) planar.push(new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = (frame * channels + channel) * bytesPerSample;
      planar[channel][frame] = readSample(view, offset, bitsPerSample, float);
    }
  }
  return planar;
}

function readSample(view: DataView, offset: number, bitsPerSample: number, float: boolean): number {
  if (float && bitsPerSample === 32) return view.getFloat32(offset, true);
  if (!float && bitsPerSample === 16) return view.getInt16(offset, true) / 32768;
  if (!float && bitsPerSample === 32) return view.getInt32(offset, true) / 2147483648;
  if (!float && bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
  return 0;
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
