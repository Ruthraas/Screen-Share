import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { registerHealthRoutes } from "./routes/health.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { authPlugin } from "./auth/plugin.js";
import type { TokenVerifier } from "./auth/verifier.js";
import { errorBody } from "./http/errors.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./groups/errors.js";
import { GroupsRepository } from "./groups/repository.js";
import type Database from "better-sqlite3";

export interface BuildServerOptions {
  verifier: TokenVerifier;
  db: Database.Database;
  corsAllowedOrigins: string[];
}

/**
 * Monta a instância do Fastify sem chamar listen() — permite testar rotas
 * via app.inject() sem abrir uma porta real (issue #28, critério de teste).
 * Toda rota exige token válido (issue #30), exceto /health.
 */
export function buildServer({ verifier, db, corsAllowedOrigins }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });

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

  app.register(authPlugin, { verifier, publicPaths: ["/health"] });
  registerHealthRoutes(app);
  registerGroupRoutes(app, new GroupsRepository(db));

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
