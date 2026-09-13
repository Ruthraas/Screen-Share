import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import { TokenVerificationError, type TokenVerifier } from "../auth/verifier.js";
import type { GroupsRepository } from "../groups/repository.js";
import { SignalingRooms } from "./room.js";
import {
  SENSITIVE_EVENT_TYPES,
  SIGNALING_PROTOCOL_VERSION,
  newCorrelationId,
  parseClientMessage,
  type ClientMessage,
  type ServerEnvelope,
} from "./protocol.js";

export interface SignalingPluginOptions {
  path: string;
  verifier: TokenVerifier;
  groupsRepo: GroupsRepository;
  rooms: SignalingRooms;
  /**
   * Intervalo do ping/pong de heartbeat (issue #42) — detecta conexão morta
   * sem `close` limpo (queda de rede, notebook suspenso, cabo arrancado:
   * o TCP não avisa nada nesses casos, e sem isso a sala ficaria com um
   * participante "fantasma" até o SO decidir encerrar o socket, o que pode
   * levar minutos). Cada ciclo sem `pong` de volta termina a conexão —
   * outros participantes recebem `peer-left` em até ~2x este intervalo em
   * vez de esperar o TCP. Configurável só pra testes (produção usa o
   * default); nunca configure isso menor que o RTT esperado dos clientes.
   */
  heartbeatIntervalMs?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function hasTarget(message: ClientMessage): message is ClientMessage & { to: string } {
  return "to" in message;
}

function send(socket: WebSocket, envelope: ServerEnvelope): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
}

function envelope(groupId: string, type: ServerEnvelope["type"], payload: unknown, extra: Partial<ServerEnvelope> = {}): ServerEnvelope {
  return { v: SIGNALING_PROTOCOL_VERSION, correlationId: newCorrelationId(), groupId, type, payload, ...extra };
}

/**
 * Serviço de sinalização WebSocket (issue #37) com autorização por
 * grupo/participante (issue #39). Conexão exige token + groupId na query
 * string (WebSocket do navegador não manda header Authorization) — o
 * mesmo TokenVerifier de #30 e a mesma policy de membership de #35, nunca
 * duplicados aqui. Nunca transporta mídia, nunca inclui SDP/ICE em log.
 */
export async function registerSignaling(app: FastifyInstance, opts: SignalingPluginOptions): Promise<void> {
  await app.register(websocketPlugin);
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  app.get(opts.path, { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    const token = query.token;
    const groupId = query.groupId;

    if (!token || !groupId) {
      send(socket, envelope(groupId ?? "", "error", { code: "bad_request", message: "token e groupId são obrigatórios." }));
      socket.close(4400, "bad_request");
      return;
    }

    let uid: string;
    try {
      const identity = await opts.verifier.verify(token);
      uid = identity.uid;
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        send(socket, envelope(groupId, "error", { code: "unauthorized", message: "Token inválido ou expirado." }));
        socket.close(4401, "unauthorized");
        return;
      }
      throw err;
    }

    // #39: nunca confiar em groupId/uid declarados sem consultar a policy.
    if (!opts.groupsRepo.getRole(groupId, uid)) {
      send(socket, envelope(groupId, "error", { code: "forbidden", message: "Você não é membro deste grupo." }));
      socket.close(4403, "forbidden");
      return;
    }

    const reconnected = opts.rooms.join(groupId, uid, socket);
    request.log.info({ groupId, uid, reconnected }, "signaling: participante entrou");

    send(socket, envelope(groupId, "joined", { members: opts.rooms.membersOf(groupId) }));
    opts.rooms.broadcast(
      groupId,
      JSON.stringify(envelope(groupId, reconnected ? "peer-reconnected" : "peer-joined", {}, { from: uid })),
      uid,
    );

    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      if (socket.readyState === socket.OPEN) socket.ping();
    }, heartbeatIntervalMs);

    socket.on("message", (raw: Buffer) => {
      let message: ClientMessage;
      try {
        message = parseClientMessage(JSON.parse(raw.toString()));
      } catch {
        send(socket, envelope(groupId, "error", { code: "invalid_message", message: "Mensagem inválida." }));
        return;
      }

      // Revalida a cada mensagem, não só na conexão: se o usuário saiu do
      // grupo enquanto conectado, a sessão para de poder enviar/receber.
      if (!opts.groupsRepo.getRole(groupId, uid)) {
        send(socket, envelope(groupId, "error", { code: "forbidden", message: "Você não é mais membro deste grupo." }));
        // O close() abaixo dispara o handler "close" registrado mais
        // adiante, que já faz rooms.leave() + broadcast de peer-left — não
        // duplicar aqui (issue #42: leave() agora só broadcasta quando de
        // fato remove a conexão atual, chamar duas vezes faria a segunda
        // chamada, no handler "close", virar um no-op e nunca avisar os
        // outros participantes).
        socket.close(4403, "forbidden");
        return;
      }

      const logPayload = SENSITIVE_EVENT_TYPES.has(message.type) ? "[omitido]" : message.payload;
      request.log.info(
        { groupId, from: uid, to: hasTarget(message) ? message.to : undefined, type: message.type, payload: logPayload },
        "signaling: evento recebido",
      );

      const out = envelope(groupId, message.type, message.payload, {
        correlationId: message.correlationId,
        from: uid,
        ...(hasTarget(message) ? { to: message.to } : {}),
      });

      if (hasTarget(message)) {
        const delivered = opts.rooms.sendTo(groupId, message.to, JSON.stringify(out));
        if (!delivered) {
          send(socket, envelope(groupId, "error", { code: "destination_unavailable", message: "Destinatário não está conectado." }));
        }
      } else {
        opts.rooms.broadcast(groupId, JSON.stringify(out), uid);
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      // leave() só remove (e devolve true) se esta ainda for a conexão
      // atual do uid — se uma reconexão já substituiu esta pela nova
      // (issue #42), o close da conexão antiga não deve avisar os outros
      // participantes de uma saída que não aconteceu de verdade.
      const left = opts.rooms.leave(groupId, uid, socket);
      if (left) {
        opts.rooms.broadcast(groupId, JSON.stringify(envelope(groupId, "peer-left", {}, { from: uid })));
      }
      request.log.info({ groupId, uid, left }, "signaling: participante saiu");
    });
  });
}

// fp() quebra o encapsulamento padrão do Fastify: sem isto, a decoração
// `injectWS`/`websocketServer` do @fastify/websocket registrado aqui dentro
// ficaria presa neste contexto filho e nunca apareceria na instância raiz
// (usada pelos testes via app.injectWS).
export default fp(registerSignaling, { name: "signaling-plugin" });
