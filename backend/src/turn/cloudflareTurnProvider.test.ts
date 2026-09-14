import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudflareTurnProvider } from "./cloudflareTurnProvider.js";
import { UpstreamError } from "../errors.js";

/** Troca `globalThis.fetch` temporariamente — só usado aqui, onde de fato
 * chamamos uma API externa via `fetch` nativo (sem SDK, ver o módulo). */
function withFetch<T>(fakeFetch: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("chama o endpoint certo da Cloudflare com Authorization Bearer e o ttl pedido", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const fakeIceServers = [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "usr", credential: "cred" },
  ];

  await withFetch(
    (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ iceServers: fakeIceServers }), { status: 201 });
    }) as typeof fetch,
    async () => {
      const provider = cloudflareTurnProvider("key-123", "token-abc");
      const result = await provider.generateIceServers(3600);
      assert.deepEqual(result, fakeIceServers);
    },
  );

  assert.equal(capturedUrl, "https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer token-abc");
  assert.equal(JSON.parse(capturedInit?.body as string).ttl, 3600);
});

test("resposta não-2xx da Cloudflare vira UpstreamError, nunca expõe o token", async () => {
  await withFetch(
    (async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
    async () => {
      const provider = cloudflareTurnProvider("key-123", "token-secreto-de-verdade");
      await assert.rejects(provider.generateIceServers(3600), (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.doesNotMatch(err.message, /token-secreto-de-verdade/);
        return true;
      });
    },
  );
});

test("falha de rede (fetch rejeita) vira UpstreamError", async () => {
  await withFetch(
    (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch,
    async () => {
      const provider = cloudflareTurnProvider("key-123", "token-abc");
      await assert.rejects(provider.generateIceServers(3600), UpstreamError);
    },
  );
});

test("resposta sem iceServers (formato inesperado) vira UpstreamError", async () => {
  await withFetch(
    (async () => new Response(JSON.stringify({ algo: "diferente" }), { status: 201 })) as typeof fetch,
    async () => {
      const provider = cloudflareTurnProvider("key-123", "token-abc");
      await assert.rejects(provider.generateIceServers(3600), UpstreamError);
    },
  );
});
