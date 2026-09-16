import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.js";

const PEPPER = "pepper-de-teste-1234567890";

test("hash de senha nunca é a senha em texto puro", async () => {
  const hash = await hashPassword("minha-senha-secreta", PEPPER);
  assert.doesNotMatch(hash, /minha-senha-secreta/);
  assert.match(hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
});

test("verifyPassword aceita a senha certa", async () => {
  const hash = await hashPassword("correta123", PEPPER);
  assert.equal(await verifyPassword("correta123", PEPPER, hash), true);
});

test("verifyPassword rejeita senha errada", async () => {
  const hash = await hashPassword("correta123", PEPPER);
  assert.equal(await verifyPassword("errada456", PEPPER, hash), false);
});

test("verifyPassword rejeita com pepper diferente do usado no hash", async () => {
  const hash = await hashPassword("correta123", PEPPER);
  assert.equal(await verifyPassword("correta123", "outro-pepper", hash), false);
});

test("dois hashes da mesma senha são diferentes (salt aleatório)", async () => {
  const a = await hashPassword("mesma-senha", PEPPER);
  const b = await hashPassword("mesma-senha", PEPPER);
  assert.notEqual(a, b);
});

test("verifyPassword rejeita formato de hash desconhecido em vez de lançar erro", async () => {
  assert.equal(await verifyPassword("qualquer", PEPPER, "formato-invalido"), false);
  assert.equal(await verifyPassword("qualquer", PEPPER, "bcrypt:algo"), false);
});
