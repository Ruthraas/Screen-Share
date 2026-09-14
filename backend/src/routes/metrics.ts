import type { FastifyInstance } from "fastify";
import type { Metrics } from "../observability/metrics.js";

/**
 * Snapshot de contadores/gauges em memória (issue #44 — "métricas mostram
 * conexões/erros"). Público como `/health`/`/ready`: só números
 * operacionais (contagens), nunca dado de usuário/conteúdo — não há nada
 * aqui que precise de autenticação pra ser seguro de expor. Formato JSON
 * simples (não Prometheus/OpenMetrics) — sem scraper nenhum configurado
 * ainda, não há razão pra adotar esse formato antes de precisar.
 */
export function registerMetricsRoutes(app: FastifyInstance, metrics: Metrics): void {
  app.get("/metrics", async () => metrics.snapshot());
}
