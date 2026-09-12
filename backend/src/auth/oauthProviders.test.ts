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
