import { test } from "node:test";
import assert from "node:assert/strict";
import { googleProvider, githubProvider, discordProvider } from "./oauthProviders.js";

const PARAMS = { clientId: "client-123", redirectUri: "http://127.0.0.1:8787/v1/auth/oauth/google/callback", state: "state-abc" };

test("Google: authorizeUrl aponta pro endpoint certo e carrega client_id/redirect_uri/state", () => {
  const url = new URL(googleProvider.authorizeUrl(PARAMS));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), PARAMS.redirectUri);
  assert.equal(url.searchParams.get("state"), "state-abc");
  assert.equal(url.searchParams.get("response_type"), "code");
});

test("GitHub: authorizeUrl aponta pro endpoint certo", () => {
  const url = new URL(githubProvider.authorizeUrl(PARAMS));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-123");
});

test("Discord: authorizeUrl aponta pro endpoint certo e inclui response_type=code", () => {
  const url = new URL(discordProvider.authorizeUrl(PARAMS));
  assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
});

// --- issue #70: nome/avatar extraídos do perfil de cada provedor -------------

/** Troca `globalThis.fetch` temporariamente — só usado aqui, onde `fetchProfile`
 * de fato chama a API de cada provedor via `fetch` nativo (sem SDK). */
function withFetch<T>(fakeFetch: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("Google: fetchProfile extrai name/picture como displayName/avatarUrl", async () => {
  await withFetch(
    (async () => jsonResponse({ sub: "123", email: "a@b.com", name: "Fulano de Tal", picture: "https://lh3.googleusercontent.com/foto.jpg" })) as typeof fetch,
    async () => {
      const profile = await googleProvider.fetchProfile("token-abc");
      assert.equal(profile.displayName, "Fulano de Tal");
      assert.equal(profile.avatarUrl, "https://lh3.googleusercontent.com/foto.jpg");
    },
  );
});

test("GitHub: fetchProfile usa name quando presente", async () => {
  await withFetch(
    (async () => jsonResponse({ id: 1, email: "a@b.com", name: "Fulano de Tal", login: "fulano", avatar_url: "https://avatars.githubusercontent.com/u/1" })) as typeof fetch,
    async () => {
      const profile = await githubProvider.fetchProfile("token-abc");
      assert.equal(profile.displayName, "Fulano de Tal");
      assert.equal(profile.avatarUrl, "https://avatars.githubusercontent.com/u/1");
    },
  );
});

test("GitHub: fetchProfile cai pro login quando name vem vazio", async () => {
  await withFetch(
    (async () => jsonResponse({ id: 1, email: "a@b.com", name: "", login: "fulano", avatar_url: "https://avatars.githubusercontent.com/u/1" })) as typeof fetch,
    async () => {
      const profile = await githubProvider.fetchProfile("token-abc");
      assert.equal(profile.displayName, "fulano");
    },
  );
});

test("Discord: fetchProfile prioriza global_name sobre username, e monta a URL do avatar a partir do hash", async () => {
  await withFetch(
    (async () => jsonResponse({ id: "999", email: "a@b.com", username: "fulano123", global_name: "Fulano de Tal", avatar: "abc123hash" })) as typeof fetch,
    async () => {
      const profile = await discordProvider.fetchProfile("token-abc");
      assert.equal(profile.displayName, "Fulano de Tal");
      assert.equal(profile.avatarUrl, "https://cdn.discordapp.com/avatars/999/abc123hash.png");
    },
  );
});

test("Discord: fetchProfile cai pro username sem global_name, e fica sem avatarUrl sem hash de avatar", async () => {
  await withFetch(
    (async () => jsonResponse({ id: "999", email: "a@b.com", username: "fulano123", global_name: null, avatar: null })) as typeof fetch,
    async () => {
      const profile = await discordProvider.fetchProfile("token-abc");
      assert.equal(profile.displayName, "fulano123");
      assert.equal(profile.avatarUrl, undefined);
    },
  );
});
