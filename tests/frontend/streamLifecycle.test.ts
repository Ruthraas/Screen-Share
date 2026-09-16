import assert from "node:assert/strict";
import test from "node:test";
import { watchStreamEnded } from "../../src/components/sharing/streamLifecycle.ts";

// EventTarget nativo do Node simula o contrato relevante de MediaStream
// (addEventListener/removeEventListener/dispatchEvent) sem precisar de DOM.
test("watchStreamEnded calls onEnded when the stream fires 'inactive'", () => {
  const stream = new EventTarget();
  let calls = 0;
  const stop = watchStreamEnded(stream, () => calls++);

  stream.dispatchEvent(new Event("inactive"));
  assert.equal(calls, 1);

  stop();
  stream.dispatchEvent(new Event("inactive"));
  assert.equal(calls, 1, "depois de parar de observar, nao deve chamar de novo");
});

test("watchStreamEnded with no stream is a safe no-op", () => {
  assert.doesNotThrow(() => watchStreamEnded(null, () => {})());
  assert.doesNotThrow(() => watchStreamEnded(undefined, () => {})());
});
