import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../server.js";
import { FakeTokenVerifier } from "../testing/fakeTokenVerifier.js";
import { createTestDb } from "../testing/testDb.js";
import { testAuthConfig } from "../testing/testAuthConfig.js";
import { fakeOAuthProvider } from "../testing/fakeOAuthProvider.js";
import { verifyAccessToken } from "../auth/sessionTokens.js";
import type { OAuthProviderName, OAuthProvider } from "../auth/oauthProviders.js";

const SIGNING_SECRET = "a".repeat(32);

function build(options: { withGoogleConfigured?: boolean } = {}) {
  const providers: Record<OAuthProviderName, OAuthProvider> = {
    google: fakeOAuthProvider("google", { "code-1": { providerAccountId: "g1", email: "oauth@example.com" } }),
    github: fakeOAuthProvider("github", {}),
    discord: fakeOAuthProvider("discord", {}),
  };

  const authConfig = testAuthConfig({
    sessionSigningSecret: SIGNING_SECRET,
    oauthProviders: options.withGoogleConfigured === false ? {} : { google: { clientId: "cid", clientSecret: "csecret" } },
  });

  return buildServer({
    verifier: new FakeTokenVerifier(),
    db: createTestDb(),
    authConfig,
    corsAllowedOrigins: ["http://127.0.0.1:5173"],
    signalingPath: "/ws",
    oauthProviders: providers,
  });
}

function hashParams(location: string): URLSearchParams {
  const url = new URL(location);
  return new URLSearchParams(url.hash.slice(1));
}

// --- registro / login / refresh / logout -----------------------------------

test("registro cria usuário e devolve access+refresh token", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "a@b.com", password: "senha-forte-123" },
    });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.ok(body.accessToken);
    assert.ok(body.refreshToken);

    const identity = verifyAccessToken(body.accessToken, SIGNING_SECRET);
    assert.equal(identity.email, "a@b.com");
  } finally {
    await app.close();
  }
});

test("registro com e-mail já usado falha com 409", async () => {
  const app = build();
  try {
    await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "a@b.com", password: "outra-senha-456" },
    });
    assert.equal(second.statusCode, 409);
  } finally {
    await app.close();
  }
});

test("registro com senha curta falha com 422 (validação Zod)", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: "a@b.com", password: "curta" },
    });
    assert.equal(response.statusCode, 422);
  } finally {
    await app.close();
  }
});

test("login com senha certa funciona", async () => {
  const app = build();
  try {
    await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } });
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@b.com", password: "senha-forte-123" } });
    assert.equal(login.statusCode, 200);
    assert.ok(login.json().accessToken);
  } finally {
    await app.close();
  }
});

test("login com senha errada e login de usuário inexistente dão a mesma resposta genérica (401)", async () => {
  const app = build();
  try {
    await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } });

    const wrongPassword = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@b.com", password: "errada" } });
    const noSuchUser = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ninguem@b.com", password: "qualquer" } });

    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(noSuchUser.statusCode, 401);
    assert.equal(wrongPassword.json().error.code, noSuchUser.json().error.code);
    assert.equal(wrongPassword.json().error.message, noSuchUser.json().error.message);
  } finally {
    await app.close();
  }
});

test("refresh emite nova sessão e revoga (rotaciona) o token antigo", async () => {
  const app = build();
  try {
    const registered = (
      await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } })
    ).json();

    const refreshed = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: registered.refreshToken } });
    assert.equal(refreshed.statusCode, 200);
    assert.ok(refreshed.json().accessToken);
    assert.notEqual(refreshed.json().refreshToken, registered.refreshToken);

    const reuseOld = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: registered.refreshToken } });
    assert.equal(reuseOld.statusCode, 401, "token antigo já rotacionado não pode ser reusado");
  } finally {
    await app.close();
  }
});

test("refresh com token inválido/inexistente falha com 401", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: "token-que-nao-existe" } });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("logout revoga o refresh token; logout de novo (idempotente) ainda responde 204", async () => {
  const app = build();
  try {
    const registered = (
      await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "a@b.com", password: "senha-forte-123" } })
    ).json();

    const logout = await app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refreshToken: registered.refreshToken } });
    assert.equal(logout.statusCode, 204);

    const refreshAfterLogout = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: registered.refreshToken } });
    assert.equal(refreshAfterLogout.statusCode, 401);

    const logoutAgain = await app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refreshToken: registered.refreshToken } });
    assert.equal(logoutAgain.statusCode, 204);
  } finally {
    await app.close();
  }
});

// --- OAuth -------------------------------------------------------------------

test("oauth start com provedor não configurado responde 404", async () => {
  const app = build({ withGoogleConfigured: false });
  try {
    const response = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("oauth start com provedor desconhecido responde 404", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/auth/oauth/facebook/start" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("oauth start redireciona pro provedor com state assinado", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start" });
    assert.equal(response.statusCode, 302);
    const location = new URL(response.headers.location as string);
    assert.equal(location.origin, "https://fake-google.example");
    assert.ok(location.searchParams.get("state"));
  } finally {
    await app.close();
  }
});

test("fluxo OAuth completo: start -> callback cria/loga usuário e devolve sessão no fragmento", async () => {
  const app = build();
  try {
    const start = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const callback = await app.inject({ method: "GET", url: `/v1/auth/oauth/google/callback?code=code-1&state=${encodeURIComponent(state)}` });
    assert.equal(callback.statusCode, 302);

    const params = hashParams(callback.headers.location as string);
    assert.equal(params.get("provider"), "google");
    assert.ok(params.get("access_token"));
    assert.ok(params.get("refresh_token"));

    const identity = verifyAccessToken(params.get("access_token")!, SIGNING_SECRET);
    assert.equal(identity.email, "oauth@example.com");
  } finally {
    await app.close();
  }
});

test("oauth start com target=desktop embute o target no state; callback redireciona pro deep link desktop", async () => {
  const app = build();
  try {
    const start = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start?target=desktop" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const callback = await app.inject({ method: "GET", url: `/v1/auth/oauth/google/callback?code=code-1&state=${encodeURIComponent(state)}` });
    assert.equal(callback.statusCode, 302);
    const location = callback.headers.location as string;
    assert.ok(location.startsWith("screenshare://oauth-callback"), `esperava deep link desktop, veio: ${location}`);
    assert.ok(hashParams(location).get("access_token"));
  } finally {
    await app.close();
  }
});

test("oauth start sem target (ou com target inválido) mantém o navegador como destino, igual ao comportamento de antes", async () => {
  const app = build();
  try {
    const semTarget = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start" });
    const stateSemTarget = new URL(semTarget.headers.location as string).searchParams.get("state")!;
    const callbackSemTarget = await app.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?code=code-1&state=${encodeURIComponent(stateSemTarget)}`,
    });
    assert.ok((callbackSemTarget.headers.location as string).startsWith("http://127.0.0.1:5173/oauth.html"));

    const targetInvalido = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start?target=celular" });
    const stateInvalido = new URL(targetInvalido.headers.location as string).searchParams.get("state")!;
    const callbackInvalido = await app.inject({
      method: "GET",
      url: `/v1/auth/oauth/google/callback?code=code-1&state=${encodeURIComponent(stateInvalido)}`,
    });
    assert.ok((callbackInvalido.headers.location as string).startsWith("http://127.0.0.1:5173/oauth.html"));
  } finally {
    await app.close();
  }
});

test("erro no fluxo desktop (ex.: missing_code) ainda volta pro deep link desktop, não pro navegador", async () => {
  const app = build();
  try {
    const start = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start?target=desktop" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const response = await app.inject({ method: "GET", url: `/v1/auth/oauth/google/callback?state=${encodeURIComponent(state)}` });
    const location = response.headers.location as string;
    assert.ok(location.startsWith("screenshare://oauth-callback"), `esperava deep link desktop, veio: ${location}`);
    assert.equal(hashParams(location).get("error"), "missing_code");
  } finally {
    await app.close();
  }
});

test("callback com state adulterado/inválido redireciona com error=invalid_state", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/callback?code=code-1&state=lixo-invalido" });
    assert.equal(response.statusCode, 302);
    assert.equal(hashParams(response.headers.location as string).get("error"), "invalid_state");
  } finally {
    await app.close();
  }
});

test("callback com erro do provedor nunca repassa o valor crú do erro", async () => {
  const app = build();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/callback?error=access_denied&error_description=o+usuario+cancelou" });
    assert.equal(response.statusCode, 302);
    const location = response.headers.location as string;
    assert.doesNotMatch(location, /access_denied/);
    assert.doesNotMatch(location, /o usuario cancelou/);
    assert.equal(hashParams(location).get("error"), "provider_error");
  } finally {
    await app.close();
  }
});

test("callback sem code redireciona com error=missing_code", async () => {
  const app = build();
  try {
    const start = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const response = await app.inject({ method: "GET", url: `/v1/auth/oauth/google/callback?state=${encodeURIComponent(state)}` });
    assert.equal(hashParams(response.headers.location as string).get("error"), "missing_code");
  } finally {
    await app.close();
  }
});

test("callback com falha na troca de código (provedor indisponível) redireciona com error=provider_error", async () => {
  const app = build();
  try {
    const start = await app.inject({ method: "GET", url: "/v1/auth/oauth/google/start" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    const response = await app.inject({ method: "GET", url: `/v1/auth/oauth/google/callback?code=code-falha&state=${encodeURIComponent(state)}` });
    assert.equal(hashParams(response.headers.location as string).get("error"), "provider_error");
  } finally {
    await app.close();
  }
});
