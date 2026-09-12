import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.js";
import { FakeTokenVerifier } from "./testing/fakeTokenVerifier.js";
import { createTestDb } from "./testing/testDb.js";

const DEV_ORIGIN = "http://127.0.0.1:5173";
const TAURI_ORIGIN = "https://tauri.localhost";
const UNKNOWN_ORIGIN = "https://evil.example.com";

function build() {
  return buildServer({
    verifier: new FakeTokenVerifier(),
    db: createTestDb(),
    corsAllowedOrigins: [DEV_ORIGIN, TAURI_ORIGIN],
    signalingPath: "/ws",
  });
}

test("origem de dev autorizada recebe Access-Control-Allow-Origin e consegue chamar /v1/groups", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/groups",
      headers: { authorization: "Bearer user:owner1", origin: DEV_ORIGIN },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], DEV_ORIGIN);
  } finally {
    await app.close();
  }
});

test("origem do Tauri (https://tauri.localhost) é autorizada", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/groups",
      headers: { authorization: "Bearer user:owner1", origin: TAURI_ORIGIN },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], TAURI_ORIGIN);
  } finally {
    await app.close();
  }
});

test("origem desconhecida é rejeitada (sem cabeçalho CORS refletido)", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/groups",
      headers: { authorization: "Bearer user:owner1", origin: UNKNOWN_ORIGIN },
    });
    assert.notEqual(response.headers["access-control-allow-origin"], UNKNOWN_ORIGIN);
  } finally {
    await app.close();
  }
});

test("preflight OPTIONS permite Authorization e Content-Type sem exigir token", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/groups",
      headers: {
        origin: DEV_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.ok([200, 204].includes(response.statusCode), `esperado 200/204, veio ${response.statusCode}`);
    assert.equal(response.headers["access-control-allow-origin"], DEV_ORIGIN);
    const allowedHeaders = (response.headers["access-control-allow-headers"] ?? "").toString().toLowerCase();
    assert.match(allowedHeaders, /authorization/);
    assert.match(allowedHeaders, /content-type/);
  } finally {
    await app.close();
  }
});

test("preflight de origem desconhecida não autoriza o método", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/groups",
      headers: {
        origin: UNKNOWN_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.notEqual(response.headers["access-control-allow-origin"], UNKNOWN_ORIGIN);
  } finally {
    await app.close();
  }
});

test("/health continua público mesmo com origem desconhecida", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/health", headers: { origin: UNKNOWN_ORIGIN } });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("requisição sem header Origin (ex.: curl) não é afetada pelo CORS", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});
