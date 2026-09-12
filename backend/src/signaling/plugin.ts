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
}

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

    opts.rooms.join(groupId, uid, socket);
    request.log.info({ groupId, uid }, "signaling: participante entrou");

    send(socket, envelope(groupId, "joined", { members: opts.rooms.membersOf(groupId) }));
    opts.rooms.broadcast(groupId, JSON.stringify(envelope(groupId, "peer-joined", {}, { from: uid })), uid);

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
        socket.close(4403, "forbidden");
        opts.rooms.leave(groupId, uid, socket);
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
      opts.rooms.leave(groupId, uid, socket);
      opts.rooms.broadcast(groupId, JSON.stringify(envelope(groupId, "peer-left", {}, { from: uid })));
      request.log.info({ groupId, uid }, "signaling: participante saiu");
    });
  });
}

// fp() quebra o encapsulamento padrão do Fastify: sem isto, a decoração
// `injectWS`/`websocketServer` do @fastify/websocket registrado aqui dentro
// ficaria presa neste contexto filho e nunca apareceria na instância raiz
// (usada pelos testes via app.injectWS).
export default fp(registerSignaling, { name: "signaling-plugin" });
