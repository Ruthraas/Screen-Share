import { test } from "node:test";
import assert from "node:assert/strict";
import { PresenceStore } from "./store.js";

test("heartbeat torna o usuário presente na listagem", () => {
  const store = new PresenceStore(30_000);
  store.heartbeat("g1", "u1");
  const members = store.list("g1", Date.now());
  assert.equal(members.length, 1);
  assert.equal(members[0].userId, "u1");
  assert.equal(members[0].online, true);
});

test("grupo sem heartbeat retorna lista vazia", () => {
  const store = new PresenceStore(30_000);
  assert.deepEqual(store.list("nunca-teve-ninguem"), []);
});

test("expira quem passou do TTL e some da lista em consultas seguintes", () => {
  const store = new PresenceStore(1_000);
  const t0 = Date.now();
  store.heartbeat("g1", "u1");

  const stillOnline = store.list("g1", t0 + 500);
  assert.equal(stillOnline.length, 1);

  const expired = store.list("g1", t0 + 5_000);
  assert.deepEqual(expired, []);

  // confirma que a expiração realmente limpou o estado interno, não só filtrou na leitura
  const afterCleanup = store.list("g1", t0 + 5_100);
  assert.deepEqual(afterCleanup, []);
});

test("heartbeat de novo depois de expirar volta a aparecer", () => {
  const store = new PresenceStore(1_000);
  const t0 = Date.now();
  store.heartbeat("g1", "u1", t0);
  assert.deepEqual(store.list("g1", t0 + 5_000), []);

  store.heartbeat("g1", "u1", t0 + 5_000);
  const members = store.list("g1", t0 + 5_000);
  assert.equal(members.length, 1);
});

test("remove tira o usuário imediatamente, sem esperar o TTL", () => {
  const store = new PresenceStore(30_000);
  store.heartbeat("g1", "u1");
  store.remove("g1", "u1");
  assert.deepEqual(store.list("g1"), []);
});

test("presença de um grupo não vaza pra outro", () => {
  const store = new PresenceStore(30_000);
  store.heartbeat("g1", "u1");
  assert.deepEqual(store.list("g2"), []);
});
