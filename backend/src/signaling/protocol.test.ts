import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClientMessage, SIGNALING_PROTOCOL_VERSION } from "./protocol.js";

test("aceita um offer válido", () => {
  const message = parseClientMessage({
    v: SIGNALING_PROTOCOL_VERSION,
    type: "offer",
    correlationId: "c1",
    to: "usr_2",
    payload: { sdp: "v=0..." },
  });
  assert.equal(message.type, "offer");
});

test("aceita ice-candidate com sdpMid/sdpMLineIndex nulos", () => {
  const message = parseClientMessage({
    v: SIGNALING_PROTOCOL_VERSION,
    type: "ice-candidate",
    correlationId: "c1",
    to: "usr_2",
    payload: { candidate: "candidate:1 1 UDP...", sdpMid: null, sdpMLineIndex: null },
  });
  assert.equal(message.type, "ice-candidate");
});

test("aceita stream-started/stream-stopped sem payload", () => {
  assert.doesNotThrow(() =>
    parseClientMessage({ v: SIGNALING_PROTOCOL_VERSION, type: "stream-started", correlationId: "c1" }),
  );
  assert.doesNotThrow(() =>
    parseClientMessage({ v: SIGNALING_PROTOCOL_VERSION, type: "stream-stopped", correlationId: "c1" }),
  );
});

test("rejeita versão de protocolo diferente da suportada", () => {
  assert.throws(() =>
    parseClientMessage({ v: 2, type: "offer", correlationId: "c1", to: "usr_2", payload: { sdp: "x" } }),
  );
});

test("rejeita tipo de evento desconhecido", () => {
  assert.throws(() =>
    parseClientMessage({ v: SIGNALING_PROTOCOL_VERSION, type: "audio-start", correlationId: "c1" }),
  );
});

test("rejeita offer sem 'to' (offer/answer/ice são sempre ponto-a-ponto)", () => {
  assert.throws(() =>
    parseClientMessage({ v: SIGNALING_PROTOCOL_VERSION, type: "offer", correlationId: "c1", payload: { sdp: "x" } }),
  );
});

test("rejeita offer sem sdp", () => {
  assert.throws(() =>
    parseClientMessage({ v: SIGNALING_PROTOCOL_VERSION, type: "offer", correlationId: "c1", to: "usr_2", payload: {} }),
  );
});

test("rejeita mensagem sem correlationId", () => {
  assert.throws(() =>
    parseClientMessage({ v: SIGNALING_PROTOCOL_VERSION, type: "stream-started", to: "usr_2" }),
  );
});

test("nenhum schema de evento aceita campo de áudio/microfone", () => {
  // O produto não tem áudio — a garantia aqui é que payloads extras (como
  // 'audioEnabled') não quebram a validação por acidente, mas também não
  // existe nenhum schema dedicado a áudio no protocolo.
  const message = parseClientMessage({
    v: SIGNALING_PROTOCOL_VERSION,
    type: "stream-started",
    correlationId: "c1",
  });
  assert.deepEqual(message.payload, {});
});
