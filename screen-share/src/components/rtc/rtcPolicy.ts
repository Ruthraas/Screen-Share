/**
 * Lógica pura do lado cliente da issue #71 — extraída de `useGroupConnections.ts`
 * pra dar pra testar sem `RTCPeerConnection`/`WebSocket` de verdade (mesmo
 * padrão de `streamLifecycle.ts`/`useStreamSelection.ts`: o que não depende
 * de API de navegador vira função pura testável, o resto é só validação
 * manual/e2e).
 */

/**
 * Perfect negotiation (padrão recomendado pelo W3C pra evitar "glare" —
 * os dois lados mandando offer ao mesmo tempo): decide, de forma
 * determinística e sem coordenação nenhuma pela rede, qual dos dois peers é
 * "polite" (aceita ter sua própria offer descartada e recomeça se receber
 * uma offer do outro lado no meio de uma negociação) — só compara os dois
 * ids, então os dois lados sempre chegam à mesma resposta.
 */
export function isPolitePeer(selfId: string, peerId: string): boolean {
  return selfId < peerId;
}

/** Pura — separada do `signalingClient.ts` de propósito: esse módulo importa
 * `authClient.ts`, que `node --test` (resolução ESM sem bundler) não resolve
 * sem extensão de arquivo explícita em todo import transitivo. Mantendo isto
 * aqui, sem nenhum import, o teste desta função não depende de nada disso. */
export function buildSignalingUrl(httpApiUrl: string, groupId: string, token: string): string {
  const url = new URL(httpApiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  url.searchParams.set("groupId", groupId);
  return url.toString();
}

export type ConnectionQuality = "good" | "ok" | "bad" | "unknown";

/** Limiares em ms de round-trip-time (`RTCIceCandidatePairStats.currentRoundTripTime`,
 * já convertido de segundos pra ms por quem chama). Valores redondos, não
 * uma medição científica — só o suficiente pra dar um sinal visual útil
 * (ícone verde/amarelo/vermelho) sem inventar precisão que `getStats()` não
 * garante entre navegadores/plataformas. */
export function classifyConnectionQuality(rttMs: number | null): ConnectionQuality {
  if (rttMs === null || !Number.isFinite(rttMs) || rttMs < 0) return "unknown";
  if (rttMs <= 150) return "good";
  if (rttMs <= 400) return "ok";
  return "bad";
}
