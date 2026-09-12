import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelection } from "../../src/components/groups/useStreamSelection.ts";

test("keeps the current selection while it stays active", () => {
  assert.equal(resolveSelection(["a", "b"], "b"), "b");
});

test("falls back predictably to the first remaining active id when the selected one ends", () => {
  // "b" estava selecionado e parou de transmitir; "a" continua ativo.
  assert.equal(resolveSelection(["a"], "b"), "a");
});

test("falls back to null when nothing is active anymore", () => {
  assert.equal(resolveSelection([], "b"), null);
});

test("with no current selection, picks the first active id", () => {
  assert.equal(resolveSelection(["a", "b"], null), "a");
});

test("selecting one participant never depends on who else is active — pure function of (activeIds, currentSelection)", () => {
  // b e c continuam ativos e nao mudam so porque a selecao trocou de a pra c.
  const activeIds = ["a", "b", "c"];
  assert.equal(resolveSelection(activeIds, "a"), "a");
  assert.equal(resolveSelection(activeIds, "c"), "c");
  assert.deepEqual(activeIds, ["a", "b", "c"], "activeIds nunca e mutado");
});
