import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.js";
import { FakeTokenVerifier } from "./testing/fakeTokenVerifier.js";
import { createTestDb } from "./testing/testDb.js";
import { testAuthConfig } from "./testing/testAuthConfig.js";

function build(db = createTestDb()) {
  return buildServer({
    verifier: new FakeTokenVerifier(),
    db,
    authConfig: testAuthConfig(),
    corsAllowedOrigins: ["http://127.0.0.1:5173"],
    signalingPath: "/ws",
  });
}

test("GET /health responde 200 com status ok (sem token)", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("GET /ready responde 200 com banco ok (sem token)", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok", checks: { database: "ok" } });
  } finally {
    await app.close();
  }
});

test("GET /ready responde 503 quando o banco está indisponível", async () => {
  const db = createTestDb();
  const app = build(db);
  try {
    db.close();
    const response = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: "error", checks: { database: "error" } });
  } finally {
    await app.close();
  }
});

test("rota inexistente sem token responde 401 (autenticação roda antes do roteamento)", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/rota-que-nao-existe" });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("rota inexistente com token válido responde 404", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/rota-que-nao-existe",
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
