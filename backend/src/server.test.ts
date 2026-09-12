import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.js";

test("GET /health responde 200 com status ok", async () => {
  const app = buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("rota inexistente responde 404", async () => {
  const app = buildServer();
  try {
    const response = await app.inject({ method: "GET", url: "/rota-que-nao-existe" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
