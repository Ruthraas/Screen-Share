import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, type BuildServerOptions } from "./server.js";
import { FakeTokenVerifier } from "./testing/fakeTokenVerifier.js";
import { createTestDb } from "./testing/testDb.js";
import { testAuthConfig } from "./testing/testAuthConfig.js";
import { fakeTurnProvider } from "./testing/fakeTurnProvider.js";
import { Metrics } from "./observability/metrics.js";

async function build(overrides: Partial<BuildServerOptions> = {}) {
  return buildServer({
    verifier: new FakeTokenVerifier(),
    db: await createTestDb(),
    authConfig: testAuthConfig(),
    turnProvider: fakeTurnProvider(),
    corsAllowedOrigins: ["http://127.0.0.1:5173"],
    signalingPath: "/ws",
    ...overrides,
  });
}

test("GET /health responde 200 com status ok (sem token)", async () => {
  const app = await build();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("GET /ready responde 200 com banco ok (sem token)", async () => {
  const app = await build();
  try {
    const response = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok", checks: { database: "ok" } });
  } finally {
    await app.close();
  }
});

test("GET /ready responde 503 quando o banco está indisponível", async () => {
  const db = await createTestDb();
  const app = await build({ db });
  try {
    db.close();
    const response = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: "error", checks: { database: "error" } });
  } finally {
    await app.close();
  }
});

test("erro nativo do Fastify (ex.: corpo vazio com Content-Type: application/json) respeita o statusCode em vez de virar 500", async () => {
  const app = await build();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      headers: { "content-type": "application/json" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "bad_request");
  } finally {
    await app.close();
  }
});

test("rota inexistente sem token responde 401 (autenticação roda antes do roteamento)", async () => {
  const app = await build();
  try {
    const response = await app.inject({ method: "GET", url: "/rota-que-nao-existe" });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("rota inexistente com token válido responde 404", async () => {
  const app = await build();
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

// --- issue #44: métricas ----------------------------------------------------

test("GET /metrics é público e devolve contadores/gauges (sem dado sensível)", async () => {
  const app = await build();
  try {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.counters, "devolve um objeto de contadores");
    assert.ok(body.gauges, "devolve um objeto de gauges");
  } finally {
    await app.close();
  }
});

test("erros incrementam errors_total{code=...} — rate_limited e not_found ficam em contadores separados", async () => {
  const metrics = new Metrics();
  const app = await build({ metrics, rateLimits: { windowMs: 60_000, register: 1, login: 10, oauth: 20, session: 30, turn: 10, wsConnect: 20 } });
  try {
    await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } });
    await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "c@d.com", password: "senha-forte-123" } }); // excede o limite (max=1)
    await app.inject({ method: "GET", url: "/rota-que-nao-existe", headers: { authorization: "Bearer valid-token" } });

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.counters['errors_total{code="rate_limited"}'], 1);
    assert.equal(snapshot.counters['errors_total{code="not_found"}'], 1);
    assert.equal(snapshot.counters['errors_total{code="internal_error"}'], undefined, "nenhum erro interno de verdade deveria ter acontecido");
  } finally {
    await app.close();
  }
});

test("http_responses_total é contado por classe de status", async () => {
  const metrics = new Metrics();
  const app = await build({ metrics });
  try {
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/rota-que-nao-existe" }); // 401

    const { counters } = metrics.snapshot();
    assert.equal(counters['http_responses_total{status_class="2xx"}'], 2);
    assert.equal(counters['http_responses_total{status_class="4xx"}'], 1);
  } finally {
    await app.close();
  }
});

// --- issue #43: limites configuráveis e corpo máximo ------------------------

test("limites de rate limit são configuráveis: valor customizado (não o default) é o que vale", async () => {
  const app = await build({ rateLimits: { windowMs: 60_000, register: 1, login: 10, oauth: 20, session: 30, turn: 10, wsConnect: 20 } });
  try {
    const first = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "c@d.com", password: "senha-forte-123" } });
    assert.equal(second.statusCode, 429, "2ª chamada já deveria bater no limite customizado de 1/min");
  } finally {
    await app.close();
  }
});

test("corpo maior que maxBodyBytes é rejeitado (413), não vira 500", async () => {
  const app = await build({ maxBodyBytes: 32 });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "a@b.com", password: "uma-senha-bem-mais-longa-que-32-bytes-no-total" },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, "bad_request");
  } finally {
    await app.close();
  }
});
