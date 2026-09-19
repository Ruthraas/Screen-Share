/**
 * Chat efêmero da sala (pedido do usuário) — transportado por um
 * `RTCDataChannel` em cima da MESMA malha de `RTCPeerConnection` que já
 * existe pra vídeo (issue #71, `useGroupConnections.ts`), não pelo
 * WebSocket de sinalização nem por nenhum serviço novo: nasce da mesma
 * negociação SDP que já roda pras tracks (`onnegotiationneeded`), e o
 * conteúdo nunca passa pelo servidor. Nunca persistido — some quando a
 * sala fecha, igual o resto da presença/sinalização (`SignalingRooms`,
 * backend).
 *
 * Extraído como funções puras (sem `RTCDataChannel` real) pelo mesmo
 * motivo de `rtcPolicy.ts`/`streamLifecycle.ts`: dá pra testar a
 * validação do formato sem precisar de WebRTC de verdade. O canal
 * transporta texto de um peer que JÁ passou pela autenticação da
 * sinalização (o `uid` vem de qual `RTCPeerConnection` a mensagem chegou,
 * nunca de um campo dentro do payload) — mesma lição do bug real corrigido
 * em `backend/src/signaling/plugin.ts`: nunca confiar em identidade
 * declarada dentro dos dados, só na conexão autenticada que os carrega.
 */

export type ChatMessage = { from: string; text: string; at: number };

/** Limite defensivo — um peer (ou um bug no próprio cliente) nunca deveria
 * conseguir mandar uma mensagem arbitrariamente grande pelo data channel. */
export const MAX_CHAT_MESSAGE_LENGTH = 2000;

/** Histórico mantido em memória por sala — chat é efêmero, não uma sala de
 * scroll infinito; corta o mais antigo em vez de crescer sem limite numa
 * sessão longa. */
export const MAX_CHAT_HISTORY = 200;

/** `null` pra texto vazio/só espaço — nunca manda nem guarda mensagem sem
 * conteúdo nenhum. */
export function normalizeChatText(raw: string): string | null {
  const trimmed = raw.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

export function encodeChatPayload(text: string, at: number): string {
  return JSON.stringify({ text, at });
}

/** `null` pra qualquer coisa que não seja um payload de chat válido — JSON
 * quebrado, formato inesperado, campos com o tipo errado, ou texto vazio
 * depois de normalizar (um peer malicioso/bugado nunca deveria conseguir
 * derrubar quem recebe, só ser ignorado). */
export function decodeChatPayload(raw: string): { text: string; at: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { text, at } = parsed as Record<string, unknown>;
  if (typeof text !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null;
  const normalized = normalizeChatText(text);
  if (normalized === null) return null;
  return { text: normalized, at };
}
