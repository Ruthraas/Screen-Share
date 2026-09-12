import assert from "node:assert/strict";
import test from "node:test";
import { AuthError, authErrorMessage, buildOAuthStartUrl, isOAuthProvider } from "../../src/services/authClient.ts";

test("oauth start url has no client-supplied query params", () => {
  const url = buildOAuthStartUrl("http://127.0.0.1:8787/", "google");
  assert.equal(url, "http://127.0.0.1:8787/v1/auth/oauth/google/start");
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

test("backend oauth error codes (fragment/deep link, no envelope) get a local pt-BR message", () => {
  assert.equal(authErrorMessage(new AuthError("provider_not_configured")), "esse provedor ainda nao foi configurado no backend");
  assert.equal(authErrorMessage(new AuthError("invalid_state")), "a tentativa de login expirou ou e invalida. tente novamente");
});

test("client-only error codes fall back to a local pt-BR message", () => {
  assert.equal(authErrorMessage(new AuthError("desktop-auth-cancelled")), "login cancelado");
  assert.equal(authErrorMessage(new AuthError("network")), "falha de rede. confira sua conexao e tente novamente");
});

test("unknown client-only codes still produce a readable fallback", () => {
  assert.equal(authErrorMessage(new AuthError("something-new")), "nao foi possivel entrar (something-new)");
});
