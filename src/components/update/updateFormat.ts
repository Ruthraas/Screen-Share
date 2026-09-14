/** Lógica pura de formatação (issue #48) — extraída pra dar pra testar sem
 * o plugin de updater/rede de verdade, mesmo padrão de `rtcPolicy.ts`. */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type ProgressSummary = { percent: number | null; label: string };

/** Sem `totalBytes` (backend não manda `Content-Length`, ou ainda não
 * chegou o evento `Started`) não dá pra saber a porcentagem — mostra só
 * quanto já baixou em vez de fingir uma barra de progresso que não é
 * real. */
export function summarizeDownloadProgress(downloadedBytes: number, totalBytes: number | null): ProgressSummary {
  if (totalBytes === null || totalBytes <= 0) {
    return { percent: null, label: `${formatBytes(downloadedBytes)} baixados` };
  }
  const percent = Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
  return { percent, label: `${percent}% — ${formatBytes(downloadedBytes)} de ${formatBytes(totalBytes)}` };
}

/** Só toca o som de "achou atualização" na TRANSIÇÃO pra `available` — nunca
 * de novo em cada re-render (o hook publica o mesmo status repetidas vezes
 * por outros motivos, ex. progresso de download) e nunca quando já estava
 * `available` antes (ex. usuário clicou "adiar" e o estado permaneceu o
 * mesmo). Pedido do usuário: som só quando acha, silêncio quando não acha. */
export function shouldPlayUpdateFoundSound(previousStatus: string, currentStatus: string): boolean {
  return currentStatus === "available" && previousStatus !== "available";
}

/** Notas de release podem vir longas/com markdown cru do changelog —
 * corta num tamanho de aviso curto (não é uma tela de changelog
 * dedicada), sempre numa fronteira de palavra pra nunca cortar no meio. */
export function summarizeReleaseNotes(notes: string | undefined, maxLength = 220): string | undefined {
  const trimmed = notes?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}
