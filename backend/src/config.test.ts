import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, toPublicSummary, ConfigError } from "./config.js";

const validEnv = {
  DATABASE_PATH: ":memory:",
  SESSION_SIGNING_SECRET: "a".repeat(32),
  PASSWORD_PEPPER: "b".repeat(16),
  OAUTH_REDIRECT_BASE_URL: "http://127.0.0.1:8787",
  TURN_HOST: "turn.example.com",
  TURN_SECRET: "super-secreto",
};

test("configuração válida: usa defaults e mantém os valores explícitos", () => {
  const config = loadConfig(validEnv);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8787);
  assert.equal(config.signaling.path, "/ws");
  assert.equal(config.database.path, ":memory:");
  assert.equal(config.turn.host, "turn.example.com");
  assert.equal(config.turn.secret, "super-secreto");
  assert.equal(config.auth.oauthRedirectBaseUrl, "http://127.0.0.1:8787");
  assert.equal(config.auth.oauthFrontendRedirectUrl, "http://127.0.0.1:5173/oauth.html");
  assert.deepEqual(config.cors.allowedOrigins, ["http://127.0.0.1:5173", "https://tauri.localhost"]);
});

test("CORS_ALLOWED_ORIGINS customizada é dividida por vírgula e sem espaços", () => {
  const config = loadConfig({ ...validEnv, CORS_ALLOWED_ORIGINS: " https://a.example.com , https://b.example.com" });
  assert.deepEqual(config.cors.allowedOrigins, ["https://a.example.com", "https://b.example.com"]);
});

test("configuração ausente: variável obrigatória faltando falha com mensagem clara", () => {
  assert.throws(
    () => loadConfig({ TURN_HOST: "turn.example.com", TURN_SECRET: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.match((err as Error).message, /DATABASE_PATH/);
      assert.match((err as Error).message, /SESSION_SIGNING_SECRET/);
      assert.match((err as Error).message, /PASSWORD_PEPPER/);
      assert.match((err as Error).message, /OAUTH_REDIRECT_BASE_URL/);
      return true;
    },
  );
});

test("configuração inválida: PORT fora do intervalo falha", () => {
  assert.throws(() => loadConfig({ ...validEnv, PORT: "70000" }));
  assert.throws(() => loadConfig({ ...validEnv, PORT: "abc" }));
});

test("configuração inválida: SESSION_SIGNING_SECRET curto falha", () => {
  assert.throws(() => loadConfig({ ...validEnv, SESSION_SIGNING_SECRET: "curto-demais" }));
});

test("configuração inválida: PASSWORD_PEPPER curto falha", () => {
  assert.throws(() => loadConfig({ ...validEnv, PASSWORD_PEPPER: "curto" }));
});

test("provedores OAuth: sem credenciais, nenhum provedor fica configurado", () => {
  const config = loadConfig(validEnv);
  assert.deepEqual(config.auth.oauthProviders, {});
});

test("provedores OAuth: só entra na lista quando client id E secret estão presentes", () => {
  const config = loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: "id-google" });
  assert.equal(config.auth.oauthProviders.google, undefined, "faltando o secret, não deve configurar");

  const complete = loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: "id-google", GOOGLE_CLIENT_SECRET: "secret-google" });
  assert.deepEqual(complete.auth.oauthProviders.google, { clientId: "id-google", clientSecret: "secret-google" });
});

test("resumo público oculta segredos", () => {
  const config = loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: "id-google", GOOGLE_CLIENT_SECRET: "secret-google" });
  const summary = toPublicSummary(config);
  const serialized = JSON.stringify(summary);

  assert.doesNotMatch(serialized, /super-secreto/);
  assert.doesNotMatch(serialized, new RegExp(validEnv.SESSION_SIGNING_SECRET));
  assert.doesNotMatch(serialized, new RegExp(validEnv.PASSWORD_PEPPER));
  assert.doesNotMatch(serialized, /secret-google/);
  assert.match(serialized, /turn\.example\.com/, "campos não sensíveis continuam visíveis");
  assert.match(serialized, /google/, "lista de provedores configurados (só o nome) continua visível");
});
