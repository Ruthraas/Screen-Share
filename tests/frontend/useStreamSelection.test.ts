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

test("excludeFromFallback: nunca cai automaticamente em quem está excluído, mesmo sendo o primeiro ativo", () => {
  // "eu" (self) e o primeiro em activeIds, mas nunca deveria ser escolhido
  // sozinho pro palco principal (pedido do usuario: ver a propria tela
  // nunca e a coisa mais importante) — cai pro proximo ativo que nao esta
  // excluido.
  assert.equal(resolveSelection(["eu", "outro"], null, ["eu"]), "outro");
});

test("excludeFromFallback: cai pra null se só sobrar gente excluída, nunca força a exclusão", () => {
  assert.equal(resolveSelection(["eu"], null, ["eu"]), null);
});

test("excludeFromFallback: não afeta uma seleção manual já ativa — só o fallback automático", () => {
  // usuario clicou no proprio avatar de proposito; continua ativo, a
  // exclusao do fallback nunca desfaz uma escolha manual.
  assert.equal(resolveSelection(["eu", "outro"], "eu", ["eu"]), "eu");
});
