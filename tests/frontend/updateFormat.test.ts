import assert from "node:assert/strict";
import test from "node:test";
import { shouldPlayUpdateFoundSound, summarizeDownloadProgress, summarizeReleaseNotes } from "../../src/components/update/updateFormat.ts";

test("summarizeDownloadProgress: sem total conhecido, so mostra quanto baixou", () => {
  const result = summarizeDownloadProgress(2048, null);
  assert.equal(result.percent, null);
  assert.equal(result.label, "2.0 KB baixados");
});

test("summarizeDownloadProgress: com total, calcula porcentagem real", () => {
  const result = summarizeDownloadProgress(50, 100);
  assert.equal(result.percent, 50);
  assert.equal(result.label, "50% — 50 B de 100 B");
});

test("summarizeDownloadProgress: nunca passa de 100% mesmo com bytes a mais que o total", () => {
  const result = summarizeDownloadProgress(150, 100);
  assert.equal(result.percent, 100);
});

test("summarizeDownloadProgress: formata KB e MB corretamente", () => {
  assert.equal(summarizeDownloadProgress(500, 1000).label.includes("500 B"), true);
  assert.equal(summarizeDownloadProgress(1536, 3072).label.includes("1.5 KB"), true);
  assert.equal(summarizeDownloadProgress(2 * 1024 * 1024, 4 * 1024 * 1024).label.includes("2.0 MB"), true);
});

test("summarizeReleaseNotes: nada ou so espaco em branco vira undefined", () => {
  assert.equal(summarizeReleaseNotes(undefined), undefined);
  assert.equal(summarizeReleaseNotes(""), undefined);
  assert.equal(summarizeReleaseNotes("   "), undefined);
});

test("summarizeReleaseNotes: texto curto passa direto", () => {
  assert.equal(summarizeReleaseNotes("corrige bug real"), "corrige bug real");
});

test("summarizeReleaseNotes: texto longo corta numa fronteira de palavra", () => {
  const long = "palavra ".repeat(50).trim();
  const result = summarizeReleaseNotes(long, 50);
  assert.ok(result!.length <= 51); // 50 + reticencias
  assert.ok(!result!.endsWith("palav…"), "nao deveria cortar no meio de uma palavra");
  assert.ok(result!.endsWith("…"));
});

test("shouldPlayUpdateFoundSound: toca so na transicao PRA available", () => {
  assert.equal(shouldPlayUpdateFoundSound("checking", "available"), true);
  assert.equal(shouldPlayUpdateFoundSound("idle", "available"), true);
});

test("shouldPlayUpdateFoundSound: nunca toca quando nao acha nada", () => {
  assert.equal(shouldPlayUpdateFoundSound("checking", "idle"), false);
  assert.equal(shouldPlayUpdateFoundSound("idle", "idle"), false);
});

test("shouldPlayUpdateFoundSound: nunca toca de novo se ja estava available (evita repetir a cada re-render)", () => {
  assert.equal(shouldPlayUpdateFoundSound("available", "available"), false);
});

test("shouldPlayUpdateFoundSound: nunca toca ao sair de available (download/erro/dispensar)", () => {
  assert.equal(shouldPlayUpdateFoundSound("available", "downloading"), false);
  assert.equal(shouldPlayUpdateFoundSound("available", "dismissed"), false);
  assert.equal(shouldPlayUpdateFoundSound("available", "error"), false);
});
