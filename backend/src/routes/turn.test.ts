import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../server.js";
import { FakeTokenVerifier } from "../testing/fakeTokenVerifier.js";
import { createTestDb } from "../testing/testDb.js";
import { testAuthConfig } from "../testing/testAuthConfig.js";
import { fakeTurnProvider, failingTurnProvider } from "../testing/fakeTurnProvider.js";
import type { TurnCredentialsProvider } from "../turn/cloudflareTurnProvider.js";

function build(turnProvider: TurnCredentialsProvider = fakeTurnProvider()) {
  return buildServer({
    verifier: new FakeTokenVerifier(),
    db: createTestDb(),
    authConfig: testAuthConfig(),
    turnProvider,
    corsAllowedOrigins: ["http://127.0.0.1:5173"],
    signalingPath: "/ws",
  });
}

function auth(uid: string) {
  return { authorization: `Bearer user:${uid}` };
}

test("usuário autenticado recebe iceServers e ttlSeconds", async () => {
  const iceServers = [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
  ];
  const app = build(fakeTurnProvider(iceServers));
  try {
    const response = await app.inject({ method: "POST", url: "/v1/turn-credentials", headers: auth("owner1") });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.deepEqual(body.iceServers, iceServers);
    assert.equal(typeof body.ttlSeconds, "number");
    assert.ok(body.ttlSeconds > 0);
  } finally {
    await app.close();
  }
});

test("sem token responde 401, nunca chama o provider de TURN", async () => {
  let called = false;
  const app = build({
    async generateIceServers() {
      called = true;
      return [];
    },
  });
  try {
    const response = await app.inject({ method: "POST", url: "/v1/turn-credentials" });
    assert.equal(response.statusCode, 401);
    assert.equal(called, false, "provider de TURN não deve ser chamado sem autenticação");
  } finally {
    await app.close();
  }
});

test("falha no provedor de TURN (ex.: Cloudflare fora do ar) responde 502, nunca 500 genérico", async () => {
  const app = build(failingTurnProvider("Cloudflare fora do ar (teste)"));
  try {
    const response = await app.inject({ method: "POST", url: "/v1/turn-credentials", headers: auth("owner1") });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "upstream_error");
  } finally {
    await app.close();
  }
});

test("rate limit por IP: excede o máximo responde 429", async () => {
  const app = build();
  try {
    let last;
    for (let i = 0; i < 11; i++) {
      last = await app.inject({ method: "POST", url: "/v1/turn-credentials", headers: auth("owner1") });
    }
    assert.equal(last!.statusCode, 429);
    assert.equal(last!.json().error.code, "rate_limited");
  } finally {
    await app.close();
  }
});
