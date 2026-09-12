import Fastify, { type FastifyInstance } from "fastify";
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
}

/**
 * Monta a instância do Fastify sem chamar listen() — permite testar rotas
 * via app.inject() sem abrir uma porta real (issue #28, critério de teste).
 * Toda rota exige token válido (issue #30), exceto /health.
 */
export function buildServer({ verifier, db }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });

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
