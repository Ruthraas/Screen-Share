import { test } from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifyPayload, SignatureError } from "./signedPayload.js";

const SECRET = "segredo-de-teste-32-caracteres!!";

test("payload assinado é verificável com o mesmo segredo", () => {
  const token = signPayload({ uid: "u1", exp: 123 }, SECRET);
  const payload = verifyPayload<{ uid: string; exp: number }>(token, SECRET);
  assert.deepEqual(payload, { uid: "u1", exp: 123 });
});

test("rejeita com segredo diferente", () => {
  const token = signPayload({ uid: "u1" }, SECRET);
  assert.throws(() => verifyPayload(token, "outro-segredo-qualquer"), SignatureError);
});

test("rejeita payload adulterado (corpo trocado, assinatura antiga)", () => {
  const token = signPayload({ uid: "u1" }, SECRET);
  const [, signature] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ uid: "admin" })).toString("base64url");
  assert.throws(() => verifyPayload(`${forgedBody}.${signature}`, SECRET), SignatureError);
});

test("rejeita token sem o formato corpo.assinatura", () => {
  assert.throws(() => verifyPayload("nao-tem-ponto", SECRET), SignatureError);
  assert.throws(() => verifyPayload("tem.dois.pontos", SECRET), SignatureError);
});
