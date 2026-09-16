import assert from "node:assert/strict";
import test from "node:test";

function installFakeLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  return store;
}

// Cada teste isola seu próprio localStorage fake e importa o módulo de
// novo (cache do Node por caminho de import — dynamic import não recarrega
// o mesmo módulo, mas como localData.ts só lê `localStorage` dentro das
// funções (nunca no top-level), reusar a mesma importação com storages
// diferentes por teste funciona sem problema.
const localDataModule = import("../../src/services/localData.ts");

test("readAccount with nothing stored returns the empty default", async () => {
  installFakeLocalStorage();
  const { readAccount, emptyAccountData } = await localDataModule;
  assert.deepEqual(readAccount("u1"), emptyAccountData());
});

test("readAccount migrates legacy data saved without an envelope (version 1, pre-#24)", async () => {
  const store = installFakeLocalStorage();
  const { readAccount } = await localDataModule;
  const legacy = { groups: [{ id: "g1", name: "dev" }], selectedId: "g1", profile: { bio: "oi" }, preferences: { theme: "light", notifications: false } };
  store.set("screenshare.account.v1.u1", JSON.stringify(legacy));
  assert.deepEqual(readAccount("u1"), legacy);
});

test("readAccount reads the current versioned envelope", async () => {
  const store = installFakeLocalStorage();
  const { readAccount } = await localDataModule;
  const data = { groups: [], selectedId: null, profile: { bio: "" }, preferences: { theme: "dark", notifications: true } };
  store.set("screenshare.account.v1.u1", JSON.stringify({ version: 1, data }));
  assert.deepEqual(readAccount("u1"), data);
});

test("writeAccount always saves the current version envelope, round-trips through readAccount", async () => {
  const store = installFakeLocalStorage();
  const { readAccount, writeAccount } = await localDataModule;
  const data = { groups: [{ id: "g1", name: "grupo" }], selectedId: "g1", profile: { bio: "bio", name: "nome" }, preferences: { theme: "light" as const, notifications: true } };
  writeAccount("u1", data);

  const raw = JSON.parse(store.get("screenshare.account.v1.u1")!);
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.data, data);
  assert.deepEqual(readAccount("u1"), data);
});

test("corrupted JSON falls back to the empty default instead of throwing", async () => {
  const store = installFakeLocalStorage();
  const { readAccount, emptyAccountData } = await localDataModule;
  store.set("screenshare.account.v1.u1", "{not valid json");
  assert.deepEqual(readAccount("u1"), emptyAccountData());
});

test("valid JSON with the wrong shape falls back to the empty default", async () => {
  const store = installFakeLocalStorage();
  const { readAccount, emptyAccountData } = await localDataModule;
  store.set("screenshare.account.v1.u1", JSON.stringify({ version: 1, data: { groups: "not-an-array" } }));
  assert.deepEqual(readAccount("u1"), emptyAccountData());
});

test("an envelope version newer than this code knows falls back safely, without crashing", async () => {
  const store = installFakeLocalStorage();
  const { readAccount, emptyAccountData } = await localDataModule;
  store.set("screenshare.account.v1.u1", JSON.stringify({ version: 99, data: { groups: [] } }));
  assert.deepEqual(readAccount("u1"), emptyAccountData());
});

test("migrations are idempotent: reading already-current data twice yields the same result", async () => {
  const store = installFakeLocalStorage();
  const { readAccount, writeAccount } = await localDataModule;
  const data = { groups: [{ id: "g1", name: "grupo" }], selectedId: "g1", profile: { bio: "" }, preferences: { theme: "dark" as const, notifications: false } };
  writeAccount("u1", data);
  const first = readAccount("u1");
  const second = readAccount("u1");
  assert.deepEqual(first, data);
  assert.deepEqual(second, data);
  assert.equal(store.size, 1, "reler nao deve criar/duplicar chaves no storage");
});
