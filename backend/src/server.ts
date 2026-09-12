import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./routes/health.js";
import { authPlugin } from "./auth/plugin.js";
import type { TokenVerifier } from "./auth/verifier.js";

export interface BuildServerOptions {
  verifier: TokenVerifier;
}

/**
 * Monta a instância do Fastify sem chamar listen() — permite testar rotas
 * via app.inject() sem abrir uma porta real (issue #28, critério de teste).
 * Toda rota exige token válido (issue #30), exceto /health.
 */
export function buildServer({ verifier }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(authPlugin, { verifier, publicPaths: ["/health"] });
  registerHealthRoutes(app);

  return app;
}
