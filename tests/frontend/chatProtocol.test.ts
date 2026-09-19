import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHAT_MESSAGE_LENGTH, decodeChatPayload, encodeChatPayload, normalizeChatText } from "../../src/components/rtc/chatProtocol.ts";

test("normalizeChatText: trims whitespace and keeps normal text intact", () => {
  assert.equal(normalizeChatText("  ola  "), "ola");
  assert.equal(normalizeChatText("mensagem normal"), "mensagem normal");
});

test("normalizeChatText: texto vazio ou so espaco vira null, nunca manda/guarda mensagem sem conteudo", () => {
  assert.equal(normalizeChatText(""), null);
  assert.equal(normalizeChatText("   "), null);
  assert.equal(normalizeChatText("\n\t"), null);
});

test("normalizeChatText: corta no limite maximo em vez de aceitar tamanho arbitrario", () => {
  const huge = "a".repeat(MAX_CHAT_MESSAGE_LENGTH + 500);
  const result = normalizeChatText(huge);
  assert.equal(result?.length, MAX_CHAT_MESSAGE_LENGTH);
});

test("encodeChatPayload/decodeChatPayload: roundtrip preserva texto e horario", () => {
  const payload = encodeChatPayload("oi pessoal", 1700000000000);
  const decoded = decodeChatPayload(payload);
  assert.deepEqual(decoded, { text: "oi pessoal", at: 1700000000000 });
});

test("decodeChatPayload: JSON invalido nunca derruba quem recebe, so retorna null", () => {
  assert.equal(decodeChatPayload("{isso nao e json"), null);
  assert.equal(decodeChatPayload("null"), null);
  assert.equal(decodeChatPayload('"so uma string"'), null);
  assert.equal(decodeChatPayload("42"), null);
});

test("decodeChatPayload: campos com tipo errado ou faltando viram null", () => {
  assert.equal(decodeChatPayload(JSON.stringify({ text: 123, at: 1 })), null, "text precisa ser string");
  assert.equal(decodeChatPayload(JSON.stringify({ text: "oi", at: "agora" })), null, "at precisa ser number");
  assert.equal(decodeChatPayload(JSON.stringify({ text: "oi" })), null, "at ausente");
  assert.equal(decodeChatPayload(JSON.stringify({ at: 1 })), null, "text ausente");
  assert.equal(decodeChatPayload(JSON.stringify({ text: "oi", at: Number.NaN })), null, "at precisa ser finito");
});

test("decodeChatPayload: texto vazio/so espaco de um peer tambem vira null, mesma regra de quem envia", () => {
  assert.equal(decodeChatPayload(JSON.stringify({ text: "   ", at: 1 })), null);
});

test("decodeChatPayload: um peer nunca consegue mandar texto maior que o limite — trunca em vez de aceitar", () => {
  const huge = "b".repeat(MAX_CHAT_MESSAGE_LENGTH + 1000);
  const decoded = decodeChatPayload(encodeChatPayload(huge, 1));
  assert.equal(decoded?.text.length, MAX_CHAT_MESSAGE_LENGTH);
});
