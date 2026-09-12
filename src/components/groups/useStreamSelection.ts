import { useEffect, useState } from "react";

/**
 * Decide o id selecionado dado quem está ativo agora — pura, sem React,
 * pra dar pra testar isolada (issue #20). Se o selecionado atual continua
 * ativo, mantém (seleção "sem perder o estado das demais": trocar quem
 * está sendo visto nunca depende de mexer em quem está transmitindo).
 * Senão, cai num fallback previsível: o próximo id em `activeIds` (mesma
 * ordem em que os participantes aparecem no grupo), ou `null` se não
 * sobrar nenhum ativo.
 */
export function resolveSelection(activeIds: string[], currentSelection: string | null): string | null {
  if (currentSelection !== null && activeIds.includes(currentSelection)) return currentSelection;
  return activeIds[0] ?? null;
}

/** Seleciona qual transmissão ativa é exibida no viewer. */
export function useStreamSelection(activeIds: string[]): [string | null, (id: string) => void] {
  const [selected, setSelected] = useState<string | null>(() => resolveSelection(activeIds, null));

  useEffect(() => {
    setSelected(current => resolveSelection(activeIds, current));
  }, [activeIds]);

  return [selected, setSelected];
}
