import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./routes/health.js";

/**
 * Monta a instância do Fastify sem chamar listen() — permite testar rotas
 * via app.inject() sem abrir uma porta real (issue #28, critério de teste).
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  registerHealthRoutes(app);

  return app;
}
