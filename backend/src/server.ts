import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { registerHealthRoutes } from "./routes/health.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerPresenceRoutes } from "./routes/presence.js";
import { authPlugin } from "./auth/plugin.js";
import type { TokenVerifier } from "./auth/verifier.js";
import { errorBody } from "./http/errors.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./groups/errors.js";
import { GroupsRepository } from "./groups/repository.js";
import { PresenceStore } from "./presence/store.js";
import { SignalingRooms } from "./signaling/room.js";
import signalingPlugin from "./signaling/plugin.js";
import type Database from "better-sqlite3";

export interface BuildServerOptions {
  verifier: TokenVerifier;
  db: Database.Database;
  corsAllowedOrigins: string[];
  signalingPath: string;
  presence?: PresenceStore;
  rooms?: SignalingRooms;
  /** Só para testes que precisam inspecionar log (ex.: confirmar que SDP/ICE não vaza). */
  logger?: FastifyServerOptions["logger"];
}

/**
 * Monta a instância do Fastify sem chamar listen() — permite testar rotas
 * via app.inject() sem abrir uma porta real (issue #28, critério de teste).
 * Toda rota HTTP exige token válido (issue #30), exceto /health. A conexão
 * WebSocket de sinalização (issue #37) autentica via query string, já que
 * o navegador não manda header Authorization no handshake de WS.
 */
export function buildServer({
  verifier,
  db,
  corsAllowedOrigins,
  signalingPath,
  presence,
  rooms,
  logger,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: logger ?? true });
  const groupsRepo = new GroupsRepository(db);
  const presenceStore = presence ?? new PresenceStore();
  const signalingRooms = rooms ?? new SignalingRooms();

  // CORS precisa vir ANTES do plugin de auth: o preflight OPTIONS do
  // navegador nunca manda Authorization, e o @fastify/cors intercepta e
  // responde o preflight sozinho antes que o onRequest de auth rode (issue
  // #59 — "preflight permite Authorization e Content-Type").
  app.register(cors, {
    origin(origin, callback) {
      // Sem header Origin (curl, chamada servidor-a-servidor, /health) não é
      // uma requisição cross-origin de navegador — CORS não se aplica.
      if (!origin || corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: false,
  });

  // "/ws" carrega token/groupId na query string, não num header Authorization
  // (o WebSocket do navegador não permite setar esse header no handshake) —
  // por isso entra em publicPaths do auth HTTP e faz sua própria verificação
  // dentro do plugin de signaling.
  app.register(authPlugin, { verifier, publicPaths: ["/health", signalingPath] });
  registerHealthRoutes(app);
  registerGroupRoutes(app, groupsRepo);
  registerPresenceRoutes(app, groupsRepo, presenceStore);
  app.register(signalingPlugin, { path: signalingPath, verifier, groupsRepo, rooms: signalingRooms });

  // Mapeia erros de domínio pro envelope de erro único do contrato (#27).
  // Erros não reconhecidos seguem pro handler padrão do Fastify (500).
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ValidationError) {
      reply.code(422).send(errorBody("validation_error", err.message, request.id));
      return;
    }
    if (err instanceof NotFoundError) {
      reply.code(404).send(errorBody("not_found", err.message, request.id));
      return;
    }
    if (err instanceof ForbiddenError) {
      reply.code(403).send(errorBody("forbidden", err.message, request.id));
      return;
    }
    if (err instanceof ConflictError) {
      reply.code(409).send(errorBody("conflict", err.message, request.id));
      return;
    }
    request.log.error({ err }, "erro não tratado");
    reply.code(500).send(errorBody("internal_error", "Erro interno.", request.id));
  });

  return app;
}
