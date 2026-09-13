import assert from "node:assert/strict";
import test from "node:test";
import { log, redactContext } from "../../src/services/logger.ts";

/** `node --test` roda fora do Vite: `import.meta.env` não existe, então
 * `logger.ts` trata isso como produção (mais seguro que assumir dev por
 * padrão) — dá pra testar o corte de debug/info sem precisar de um build
 * de produção de verdade. */
function captureConsole<T>(run: () => T): { result: T; calls: Record<"debug" | "info" | "warn" | "error", unknown[][]> } {
  const calls: Record<"debug" | "info" | "warn" | "error", unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  const original = { debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  console.debug = (...args: unknown[]) => calls.debug.push(args);
  console.info = (...args: unknown[]) => calls.info.push(args);
  console.warn = (...args: unknown[]) => calls.warn.push(args);
  console.error = (...args: unknown[]) => calls.error.push(args);
  try {
    return { result: run(), calls };
  } finally {
    Object.assign(console, original);
  }
}

test("outside Vite (no import.meta.env.DEV), debug/info are suppressed but warn/error still print — 'producao nao exibe debug excessivo'", () => {
  const { calls } = captureConsole(() => {
    log.debug("auth", "nao deveria aparecer");
    log.info("auth", "nao deveria aparecer");
    log.warn("auth", "login falhou", { code: "unauthorized" });
    log.error("capture", "falha grave");
  });
  assert.equal(calls.debug.length, 0);
  assert.equal(calls.info.length, 0);
  assert.equal(calls.warn.length, 1);
  assert.equal(calls.error.length, 1);
});

test("a warn/error call keeps useful context (scope, message, error code) while redacting secrets and e-mails in it", () => {
  const { calls } = captureConsole(() => {
    log.warn("auth", "login falhou", { code: "unauthorized", password: "hunter2", email: "user@example.com" });
  });
  const [prefix, message, context] = calls.warn[0];
  assert.equal(prefix, "[auth]");
  assert.equal(message, "login falhou");
  assert.deepEqual(context, { code: "unauthorized", password: "[omitido]", email: "[omitido]" });
});

test("redacts password/senha/token/secret/authorization fields regardless of casing", () => {
  const safe = redactContext({
    password: "hunter2",
    senha: "hunter2",
    token: "abc.def",
    accessToken: "abc.def",
    refresh_token: "xyz",
    Authorization: "Bearer abc",
    clientSecret: "shh",
    oauthCode: "4/abc",
  });

  for (const value of Object.values(safe)) {
    assert.equal(value, "[omitido]");
  }
});

test("keeps safe fields untouched, including the error 'code' field the acceptance criteria requires", () => {
  const safe = redactContext({ code: "invalid_state", status: 401, provider: "google" });
  assert.deepEqual(safe, { code: "invalid_state", status: 401, provider: "google" });
});

test("redacts e-mail fields (mandatory validation: search logs for test tokens/e-mails)", () => {
  const safe = redactContext({ email: "user@example.com", "e-mail": "user@example.com", userEmail: "user@example.com" });
  assert.deepEqual(safe, { email: "[omitido]", "e-mail": "[omitido]", userEmail: "[omitido]" });
});

test("redacts sensitive fields nested inside objects/arrays, not just top level", () => {
  const safe = redactContext({
    session: { credentials: { accessToken: "abc", refreshToken: "def" }, user: { id: "u1" } },
    attempts: [{ password: "hunter2" }, { code: "network" }],
  });

  assert.deepEqual(safe, {
    session: { credentials: { accessToken: "[omitido]", refreshToken: "[omitido]" }, user: { id: "u1" } },
    attempts: [{ password: "[omitido]" }, { code: "network" }],
  });
});

test("caps recursion depth instead of looping forever on a deeply nested object", () => {
  let deep: Record<string, unknown> = { leaf: "ok" };
  for (let i = 0; i < 20; i++) deep = { nested: deep };
  assert.doesNotThrow(() => redactContext({ deep }));
});
