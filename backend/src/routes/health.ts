import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

/**
 * `/health` (liveness) só confirma que o processo Node está de pé —
 * nunca falha por causa de dependência externa, é o que orquestrador/monitor
 * usa pra saber se deve reiniciar o processo.
 *
 * `/ready` (readiness) confirma que o backend consegue de fato atender
 * requisição: banco acessível (a única dependência real hoje — TURN/#40
 * ainda não existe). Usar isso pra saber se o processo já pode receber
 * tráfego (ex.: atrás de um load balancer) ou, na prática hoje, pra
 * diagnosticar rápido durante testes manuais se o banco está saudável.
 */
export function registerHealthRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (_request, reply) => {
    try {
      db.prepare("SELECT 1").get();
    } catch (err) {
      app.log.error({ err }, "readiness: banco indisponível");
      reply.code(503);
      return { status: "error", checks: { database: "error" } };
    }
    return { status: "ok", checks: { database: "ok" } };
  });
}
