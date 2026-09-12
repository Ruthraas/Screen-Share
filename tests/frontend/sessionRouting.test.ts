import assert from "node:assert/strict";
import test from "node:test";
import { parseRouteHash, routeAfterLogin, routeForSignedOut, sessionView } from "../../src/services/sessionRouting.ts";

test("session view covers loading, error login and authenticated app states", () => {
  assert.equal(sessionView({ ready: false, user: null, error: null }), "loading");
  assert.equal(sessionView({ ready: true, user: null, error: "auth/session-failed" }), "login");
  assert.equal(sessionView({ ready: true, user: { uid: "u1" }, error: null }), "app");
});

test("signed out users are redirected away from protected routes", () => {
  assert.equal(routeForSignedOut("share"), "login");
  assert.equal(routeForSignedOut("settings"), "login");
  assert.equal(routeForSignedOut("login"), "login");
});

test("login route resolves to empty state when the account has no groups", () => {
  assert.equal(routeAfterLogin("login", { groups: [], selectedId: null }), "empty");
  assert.equal(routeAfterLogin("home", { groups: [], selectedId: null }), "empty");
});

test("login route resolves to home when the account already has groups", () => {
  assert.equal(routeAfterLogin("login", { groups: [{ id: "g1", name: "dev" }], selectedId: "g1" }), "home");
  assert.equal(routeAfterLogin("share", { groups: [{ id: "g1", name: "dev" }], selectedId: "g1" }), "share");
});

test("route hash parser rejects unknown routes", () => {
  assert.equal(parseRouteHash("#/profile"), "profile");
  assert.equal(parseRouteHash("#/unknown"), "login");
  assert.equal(parseRouteHash(""), "login");
});
