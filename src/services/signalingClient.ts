import { apiUrl, getAccessToken } from "./authClient";
import { log } from "./logger";
import { buildSignalingUrl } from "../components/rtc/rtcPolicy";

/**
 * Cliente WebSocket do protocolo de sinalização (issue #38, backend,
 * `backend/src/signaling/protocol.ts`) — join/offer/answer/ice-candidate/
 * stream-started/stream-stopped contra `/ws?token=...&groupId=...` (o
 * WebSocket do navegador não permite header `Authorization`, por isso o
 * token vai na query string, igual o backend já documenta). Nunca loga
 * `payload` de offer/answer/ice-candidate (pode carregar SDP) — só o tipo
 * do evento.
 *
 * Limitação conhecida, não corrigível só do lado do cliente: se a conexão
 * falhar, o PRÓPRIO navegador (não este código) registra a URL completa —
 * token incluído — no console nativo do DevTools (achado real testando:
 * vazou no smoke test antes da interceptação de `/ws` em `check-ui.mjs`).
 * Não tem como suprimir esse log nativo via JS. Mitigado hoje por nunca
 * mandar esse log a lugar nenhum fora da própria máquina do usuário
 * (`logger.ts`: só `console.*`, sem telemetria remota — ver README §9);
 * uma correção completa exigiria o backend aceitar um ticket de curta
 * duração em vez do access token de verdade na query string do `/ws`
 * (mudança de protocolo, fora do escopo desta issue — não é decisão pra
 * tomar sem o @ProgVictorPe).
 */
export const SIGNALING_PROTOCOL_VERSION = 1 as const;

export type ClientMessage =
  | { type: "offer"; to: string; payload: { sdp: string } }
  | { type: "answer"; to: string; payload: { sdp: string } }
  | { type: "ice-candidate"; to: string; payload: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { type: "stream-started"; payload: Record<string, never> }
  | { type: "stream-stopped"; payload: Record<string, never> };

export type ServerEvent =
  | { type: "joined"; payload: { members: string[] } }
  | { type: "peer-joined"; from: string; payload: unknown }
  | { type: "peer-reconnected"; from: string; payload: unknown }
  | { type: "peer-left"; from: string; payload: unknown }
  | { type: "offer"; from: string; payload: { sdp: string } }
  | { type: "answer"; from: string; payload: { sdp: string } }
  | { type: "ice-candidate"; from: string; payload: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { type: "stream-started"; from: string; payload: unknown }
  | { type: "stream-stopped"; from: string; payload: unknown }
  | { type: "error"; payload: { code: string; message: string } };

const SENSITIVE_EVENT_TYPES = new Set(["offer", "answer", "ice-candidate"]);

function newCorrelationId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `c${Date.now()}${Math.random()}`;
}

export type SignalingHandle = {
  send: (message: ClientMessage) => void;
  close: () => void;
};

/**
 * Abre uma conexão e reconecta sozinha (backoff simples, tampado) se cair
 * de forma inesperada — `close()` explícito nunca reconecta. O backend já
 * trata reconexão de PEER (issue #42, `peer-reconnected`); isto aqui é só a
 * conexão de sinalização em si ficar de pé outra vez, pra alguém continuar
 * podendo mandar/receber sinalização sem precisar trocar de tela.
 */
export function connectSignaling(groupId: string, onEvent: (event: ServerEvent) => void): SignalingHandle {
  let socket: WebSocket | null = null;
  let closedByCaller = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect() {
    if (closedByCaller) return;
    const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 15_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(open, delayMs);
  }

  function open() {
    const token = getAccessToken();
    if (!token) {
      log.warn("rtc", "sinalizacao sem sessao ativa, nao conectou");
      return;
    }
    const url = buildSignalingUrl(apiUrl("/ws"), groupId, token);
    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener("open", () => {
      reconnectAttempt = 0;
      log.info("rtc", "sinalizacao conectada");
    });
    ws.addEventListener("message", raw => {
      let event: ServerEvent;
      try {
        event = JSON.parse(raw.data as string);
      } catch {
        log.warn("rtc", "sinalizacao recebeu mensagem invalida");
        return;
      }
      log.debug("rtc", "sinalizacao: evento recebido", {
        type: event.type,
        payload: SENSITIVE_EVENT_TYPES.has(event.type) ? "[omitido]" : event.payload,
      });
      onEvent(event);
    });
    ws.addEventListener("close", ev => {
      log.warn("rtc", "sinalizacao desconectada", { code: ev.code });
      if (!closedByCaller) scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      log.warn("rtc", "sinalizacao: erro de conexao");
    });
  }

  open();

  return {
    send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        log.warn("rtc", "tentativa de enviar sinalizacao sem conexao aberta", { type: message.type });
        return;
      }
      socket.send(JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, correlationId: newCorrelationId(), ...message }));
    },
    close() {
      closedByCaller = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "client-close");
    },
  };
}
