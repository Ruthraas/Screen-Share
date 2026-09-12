import { test } from "node:test";
import assert from "node:assert/strict";
import { issueAccessToken, verifyAccessToken, newRefreshTokenValue, hashRefreshToken } from "./sessionTokens.js";
import { signPayload } from "./signedPayload.js";
import { TokenVerificationError } from "./verifier.js";

const SECRET = "segredo-de-teste-32-caracteres!!";

test("token de acesso emitido é verificável e devolve a identidade", () => {
  const token = issueAccessToken({ uid: "u1", email: "a@b.com" }, SECRET);
  const identity = verifyAccessToken(token, SECRET);
  assert.deepEqual(identity, { uid: "u1", email: "a@b.com" });
});

test("rejeita token assinado com outro segredo", () => {
  const token = issueAccessToken({ uid: "u1" }, SECRET);
  assert.throws(() => verifyAccessToken(token, "outro-segredo"), TokenVerificationError);
});

test("rejeita token expirado", () => {
  const expired = signPayload({ uid: "u1", exp: Date.now() - 1000 }, SECRET);
  assert.throws(() => verifyAccessToken(expired, SECRET), TokenVerificationError);
});

test("refresh token novo é opaco (não é o hash) e o hash é determinístico", () => {
  const value = newRefreshTokenValue();
  const hash1 = hashRefreshToken(value);
  const hash2 = hashRefreshToken(value);
  assert.notEqual(value, hash1);
  assert.equal(hash1, hash2);
});

test("valores diferentes de refresh token produzem hashes diferentes", () => {
  const a = newRefreshTokenValue();
  const b = newRefreshTokenValue();
  assert.notEqual(hashRefreshToken(a), hashRefreshToken(b));
});
