import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, toPublicSummary, ConfigError } from "./config.js";

const validEnv = {
  DATABASE_PATH: ":memory:",
  FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"test"}',
  TURN_HOST: "turn.example.com",
  TURN_SECRET: "super-secreto",
};

test("configuração válida: usa defaults de HOST/PORT/SIGNALING_PATH e mantém os valores explícitos", () => {
  const config = loadConfig(validEnv);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8787);
  assert.equal(config.signaling.path, "/ws");
  assert.equal(config.database.path, ":memory:");
  assert.equal(config.turn.host, "turn.example.com");
  assert.equal(config.turn.secret, "super-secreto");
});

test("configuração válida: aceita FIREBASE_SERVICE_ACCOUNT_PATH no lugar do JSON", () => {
  const config = loadConfig({
    DATABASE_PATH: ":memory:",
    FIREBASE_SERVICE_ACCOUNT_PATH: "./secrets/firebase.json",
    TURN_HOST: "turn.example.com",
    TURN_SECRET: "super-secreto",
  });
  assert.equal(config.auth.firebaseServiceAccountPath, "./secrets/firebase.json");
});

test("configuração ausente: variável obrigatória faltando falha com mensagem clara", () => {
  assert.throws(
    () => loadConfig({ TURN_HOST: "turn.example.com", TURN_SECRET: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.match((err as Error).message, /DATABASE_PATH/);
      return true;
    },
  );
});

test("configuração ausente: nenhuma credencial Firebase informada falha", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_PATH: ":memory:",
        TURN_HOST: "turn.example.com",
        TURN_SECRET: "x",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.match((err as Error).message, /FIREBASE_SERVICE_ACCOUNT/);
      return true;
    },
  );
});

test("configuração inválida: PORT fora do intervalo falha", () => {
  assert.throws(() => loadConfig({ ...validEnv, PORT: "70000" }));
  assert.throws(() => loadConfig({ ...validEnv, PORT: "abc" }));
});

test("resumo público oculta segredos", () => {
  const config = loadConfig(validEnv);
  const summary = toPublicSummary(config);
  const serialized = JSON.stringify(summary);

  assert.doesNotMatch(serialized, /super-secreto/);
  assert.doesNotMatch(serialized, /project_id/);
  assert.match(serialized, /turn\.example\.com/, "campos não sensíveis continuam visíveis");
});
