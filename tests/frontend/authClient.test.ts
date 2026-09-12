import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, authErrorMessage, buildOAuthStartUrl, isOAuthProvider } from "../../src/services/authClient.ts";

test("oauth start url carries redirect_uri and state as query params", () => {
  const url = buildOAuthStartUrl("http://127.0.0.1:8787/", "google", "http://127.0.0.1:5173/oauth.html", "nonce-1");
  assert.equal(url, "http://127.0.0.1:8787/v1/auth/oauth/google/start?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Foauth.html&state=nonce-1");
});

test("isOAuthProvider accepts only the three supported providers", () => {
  assert.equal(isOAuthProvider("google"), true);
  assert.equal(isOAuthProvider("github"), true);
  assert.equal(isOAuthProvider("discord"), true);
  assert.equal(isOAuthProvider("facebook"), false);
});

test("auth error messages prefer the backend's pt-BR message over the raw code", () => {
  const fromBackend = new AuthError("invalid-credentials", "email ou senha invalidos");
  assert.equal(authErrorMessage(fromBackend), "email ou senha invalidos");
});

test("client-only error codes fall back to a local pt-BR message", () => {
  assert.equal(authErrorMessage(new AuthError("popup-closed-by-user")), "login cancelado");
  assert.equal(authErrorMessage(new AuthError("network")), "falha de rede. confira sua conexao e tente novamente");
});

test("unknown client-only codes still produce a readable fallback", () => {
  assert.equal(authErrorMessage(new AuthError("something-new")), "nao foi possivel entrar (something-new)");
});
