import assert from "node:assert/strict";
import test from "node:test";
import { decodeInterleavedPcm } from "../../src/components/sharing/pcmAudio.ts";

test("decodes interleaved float32 stereo PCM into planar channels", () => {
  const format = { sampleRate: 48000, channels: 2, bitsPerSample: 32, float: true };
  // 2 frames: L0=0.5 R0=-0.5, L1=1 R1=-1
  const samples = new Float32Array([0.5, -0.5, 1, -1]);
  const bytes = new Uint8Array(samples.buffer);

  const [left, right] = decodeInterleavedPcm(bytes, format);

  assert.deepEqual(Array.from(left), [0.5, 1]);
  assert.deepEqual(Array.from(right), [-0.5, -1]);
});

test("decodes interleaved int16 mono PCM, normalized to [-1, 1]", () => {
  const format = { sampleRate: 44100, channels: 1, bitsPerSample: 16, float: false };
  const view = new DataView(new ArrayBuffer(4));
  view.setInt16(0, 16384, true); // ~0.5
  view.setInt16(2, -32768, true); // -1
  const bytes = new Uint8Array(view.buffer);

  const [channel] = decodeInterleavedPcm(bytes, format);

  assert.equal(channel.length, 2);
  assert.ok(Math.abs(channel[0] - 0.5) < 0.001);
  assert.equal(channel[1], -1);
});

test("truncated trailing bytes (partial frame) are dropped instead of read out of bounds", () => {
  const format = { sampleRate: 48000, channels: 2, bitsPerSample: 32, float: true };
  const samples = new Float32Array([0.1, 0.2, 0.3]); // 1.5 frames worth for stereo
  const bytes = new Uint8Array(samples.buffer);

  const [left, right] = decodeInterleavedPcm(bytes, format);

  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
});

test("empty buffer decodes to empty channels without throwing", () => {
  const format = { sampleRate: 48000, channels: 2, bitsPerSample: 32, float: true };
  const [left, right] = decodeInterleavedPcm(new Uint8Array(0), format);
  assert.equal(left.length, 0);
  assert.equal(right.length, 0);
});
