import assert from "node:assert/strict";
import test from "node:test";

function installFakeSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  return store;
}

function fakeAccessToken(uid: string) {
  const payload = Buffer.from(JSON.stringify({ uid, email: "a@b.com", exp: Date.now() + 900_000 })).toString("base64url");
  return `${payload}.fakesig`;
}

// Regressão real encontrada rodando contra o backend de verdade (issue #2):
// o backend rotaciona o refresh token a cada uso — duas chamadas
// concorrentes com o mesmo token (React StrictMode dobra o efeito de
// `useSession` em dev) faziam a segunda usar um token já revogado pela
// primeira, derrubando a sessão com "session-expired" logo após o login.
test("refreshSession deduplicates concurrent calls into a single request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installFakeSessionStorage();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    fetchCalls++;
    const accessToken = fakeAccessToken("u1");
    return new Response(JSON.stringify({ accessToken, refreshToken: "rotated-refresh-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { __setApiBaseUrlForTests, refreshSession } = await import("../../src/services/authClient.ts");
    __setApiBaseUrlForTests("http://127.0.0.1:8787");
    const [first, second] = await Promise.all([refreshSession("old-refresh-token"), refreshSession("old-refresh-token")]);

    assert.equal(fetchCalls, 1);
    assert.equal(first.user.id, "u1");
    assert.deepEqual(first, second);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
