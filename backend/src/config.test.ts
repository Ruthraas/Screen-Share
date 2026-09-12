import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("usa host/porta padrão quando env está vazio", () => {
  const config = loadConfig({});
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8787);
});

test("lê PORT e HOST do env quando presentes", () => {
  const config = loadConfig({ PORT: "9999", HOST: "127.0.0.1" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9999);
});

test("rejeita PORT inválida", () => {
  assert.throws(() => loadConfig({ PORT: "abc" }));
  assert.throws(() => loadConfig({ PORT: "-1" }));
  assert.throws(() => loadConfig({ PORT: "0" }));
});
