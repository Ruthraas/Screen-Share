import { useEffect, useState } from "react";

/**
 * Decide o id selecionado dado quem está ativo agora — pura, sem React,
 * pra dar pra testar isolada (issue #20). Se o selecionado atual continua
 * ativo, mantém (seleção "sem perder o estado das demais": trocar quem
 * está sendo visto nunca depende de mexer em quem está transmitindo).
 * Senão, cai num fallback previsível: o próximo id em `activeIds` (mesma
 * ordem em que os participantes aparecem no grupo) que não esteja em
 * `excludeFromFallback`, ou `null` se não sobrar nenhum.
 *
 * `excludeFromFallback` (pedido do usuário: ver a própria transmissão
 * nunca é a coisa mais importante da tela) só afeta o FALLBACK automático
 * — se o próprio usuário já estava selecionado manualmente (clicou no seu
 * avatar de propósito) e continua ativo, a seleção é mantida normalmente
 * pela checagem acima; a exclusão só evita que o palco pule pra ele sem
 * ninguém ter pedido isso.
 */
export function resolveSelection(activeIds: string[], currentSelection: string | null, excludeFromFallback: readonly string[] = []): string | null {
  if (currentSelection !== null && activeIds.includes(currentSelection)) return currentSelection;
  return activeIds.find(id => !excludeFromFallback.includes(id)) ?? null;
}

/** Seleciona qual transmissão ativa é exibida no viewer. `null` limpa a
 * seleção de propósito (issue #71: fechar o `ScreenViewer` remoto sem
 * escolher outro participante) — `resolveSelection` só reage quando
 * `activeIds` muda, então isso não volta sozinho pro primeiro ativo. */
export function useStreamSelection(activeIds: string[], excludeFromFallback: readonly string[] = []): [string | null, (id: string | null) => void] {
  const [selected, setSelected] = useState<string | null>(() => resolveSelection(activeIds, null, excludeFromFallback));

  useEffect(() => {
    setSelected(current => resolveSelection(activeIds, current, excludeFromFallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds, excludeFromFallback.join(",")]);

  return [selected, setSelected];
}
