import assert from "node:assert/strict";
import test from "node:test";

function fakeAccessToken(uid: string, email: string) {
  const payload = Buffer.from(JSON.stringify({ uid, email, exp: Date.now() + 900_000 })).toString("base64url");
  return `${payload}.fakesig`;
}

function installFakeSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  return store;
}

// Isolado num arquivo próprio: instala um `sessionStorage` fake no global e
// usa timers mockados (a sessão bem-sucedida agenda um refresh silencioso
// via `setTimeout`, que nunca deve virar um timer real pendurando o
// processo de teste).
test("completeOAuthFromFragment persists the session on success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = installFakeSessionStorage();
  const { completeOAuthFromFragment } = await import("../../src/services/authClient.ts");

  const accessToken = fakeAccessToken("u1", "a@b.com");
  await completeOAuthFromFragment(`#access_token=${accessToken}&refresh_token=refresh-abc&provider=google`);

  assert.equal(store.get("screenshare.refresh_token"), "refresh-abc");
  assert.equal(store.has("screenshare.oauth_error"), false);
});

test("completeOAuthFromFragment stores the backend error code without touching the refresh token", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = installFakeSessionStorage();
  const { completeOAuthFromFragment } = await import("../../src/services/authClient.ts");

  await completeOAuthFromFragment("#error=provider_not_configured");

  assert.equal(store.get("screenshare.oauth_error"), "provider_not_configured");
  assert.equal(store.has("screenshare.refresh_token"), false);
});

test("completeOAuthFromFragment treats a malformed fragment as an error, never as a session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = installFakeSessionStorage();
  const { completeOAuthFromFragment } = await import("../../src/services/authClient.ts");

  await completeOAuthFromFragment("#access_token=not-a-real-token");

  assert.equal(store.get("screenshare.oauth_error"), "malformed-response");
  assert.equal(store.has("screenshare.refresh_token"), false);
});
