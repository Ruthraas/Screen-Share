import assert from "node:assert/strict";
import test from "node:test";
import { buildSignalingUrl, classifyConnectionQuality, isPolitePeer } from "../../src/components/rtc/rtcPolicy.ts";

test("isPolitePeer: the lexicographically smaller id is polite, deterministic both ways", () => {
  assert.equal(isPolitePeer("a", "b"), true);
  assert.equal(isPolitePeer("b", "a"), false);
  assert.equal(isPolitePeer("same", "same"), false); // nunca os dois polite (nunca acontece na pratica, ids sao unicos)
});

test("classifyConnectionQuality: thresholds", () => {
  assert.equal(classifyConnectionQuality(0), "good");
  assert.equal(classifyConnectionQuality(150), "good");
  assert.equal(classifyConnectionQuality(151), "ok");
  assert.equal(classifyConnectionQuality(400), "ok");
  assert.equal(classifyConnectionQuality(401), "bad");
  assert.equal(classifyConnectionQuality(5000), "bad");
});

test("classifyConnectionQuality: valores invalidos viram unknown, nunca quebram", () => {
  assert.equal(classifyConnectionQuality(null), "unknown");
  assert.equal(classifyConnectionQuality(-1), "unknown");
  assert.equal(classifyConnectionQuality(NaN), "unknown");
  assert.equal(classifyConnectionQuality(Infinity), "unknown");
});

test("buildSignalingUrl: troca http por ws, preserva o resto, adiciona token/groupId", () => {
  const url = buildSignalingUrl("http://127.0.0.1:8787/ws", "grp-1", "tok-abc");
  assert.equal(url, "http://127.0.0.1:8787/ws?token=tok-abc&groupId=grp-1".replace("http:", "ws:"));
});

test("buildSignalingUrl: troca https por wss", () => {
  const url = buildSignalingUrl("https://api.example.com/ws", "grp-2", "tok-2");
  assert.ok(url.startsWith("wss://api.example.com/ws"));
});

test("buildSignalingUrl: token/groupId vao com escaping correto de URL", () => {
  const url = buildSignalingUrl("http://localhost/ws", "grupo com espaço", "tok+especial");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("groupId"), "grupo com espaço");
  assert.equal(parsed.searchParams.get("token"), "tok+especial");
});
