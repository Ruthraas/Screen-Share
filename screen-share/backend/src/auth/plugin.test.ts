import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { authPlugin } from "./plugin.js";
import { FakeTokenVerifier } from "../testing/fakeTokenVerifier.js";

function buildTestApp() {
  const app = Fastify();
  app.register(authPlugin, { verifier: new FakeTokenVerifier(), publicPaths: ["/health"] });
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/protected", async (request) => ({ auth: request.auth }));
  return app;
}

test("caminho público com query string ainda é reconhecido como público", async () => {
  // regressão: request.url inclui a query string, então comparar publicPaths
  // contra a URL crua nunca bate para algo como "/health?x=1" (ou o /ws do
  // signaling, que sempre carrega ?token=...&groupId=...).
  const app = buildTestApp();
  try {
    const response = await app.inject({ method: "GET", url: "/health?debug=1" });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("caminho público não exige token", async () => {
  const app = buildTestApp();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("rota protegida sem header Authorization retorna 401", async () => {
  const app = buildTestApp();
  try {
    const response = await app.inject({ method: "GET", url: "/protected" });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "unauthorized");
  } finally {
    await app.close();
  }
});

test("rota protegida com header sem 'Bearer ' retorna 401", async () => {
  const app = buildTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Token valid-token" },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("rota protegida com token inválido/expirado retorna 401", async () => {
  const app = buildTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer expired-token" },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "unauthorized");
  } finally {
    await app.close();
  }
});

test("rota protegida com token válido produz identidade normalizada", async () => {
  const app = buildTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      auth: { uid: "usr_123", email: "usuario@example.com" },
    });
  } finally {
    await app.close();
  }
});

test("resposta de erro nunca inclui o token recebido", async () => {
  const app = buildTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer expired-token" },
    });
    assert.doesNotMatch(JSON.stringify(response.json()), /expired-token/);
  } finally {
    await app.close();
  }
});
