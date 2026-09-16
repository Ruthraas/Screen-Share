import type { FastifyInstance } from "fastify";
import type { Client } from "@libsql/client";

/**
 * `/health` (liveness) só confirma que o processo Node está de pé —
 * nunca falha por causa de dependência externa, é o que orquestrador/monitor
 * usa pra saber se deve reiniciar o processo.
 *
 * `/ready` (readiness) confirma que o backend consegue de fato atender
 * requisição: banco acessível (issue #82: agora uma chamada de rede real
 * pro Turso, não mais um arquivo local — por isso pode de fato falhar por
 * latência/indisponibilidade, não só um caso teórico).
 */
export function registerHealthRoutes(app: FastifyInstance, db: Client): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (_request, reply) => {
    try {
      await db.execute("SELECT 1");
    } catch (err) {
      app.log.error({ err }, "readiness: banco indisponível");
      reply.code(503);
      return { status: "error", checks: { database: "error" } };
    }
    return { status: "ok", checks: { database: "ok" } };
  });
}
