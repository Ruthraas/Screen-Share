import type { FastifyInstance } from "fastify";
import type { TurnCredentialsProvider } from "../turn/cloudflareTurnProvider.js";
import type { AppConfig } from "../config.js";

/** Sessão de compartilhamento não deveria durar mais que isso sem renovar —
 * ver docs/WEBRTC_TURN_PLAN.md pra como o cliente (#71) deve tratar renovação. */
const TURN_CREDENTIALS_TTL_SECONDS = 3600;

/** Default só pra quem chama `registerTurnRoutes` sem passar `rateLimits`
 * (ex.: testes) — produção sempre recebe o valor de `config.rateLimits`
 * (issue #43, configurável via `RATE_LIMIT_TURN_MAX`). */
const DEFAULT_TURN_RATE_LIMIT_MAX = 10;
const DEFAULT_TURN_RATE_LIMIT_WINDOW_MS = 60_000;

function requireAuth(request: { auth?: { uid: string } }): string {
  if (!request.auth) throw new Error("request.auth ausente — auth plugin não rodou");
  return request.auth.uid;
}

/**
 * Credenciais TURN de curta duração (issue #41) via Cloudflare Realtime TURN
 * (issue #40 — decisão registrada em docs/backend/ARQUITETURA.md). Exige
 * sessão autenticada (rota não está em publicPaths/publicPrefixes); a
 * resposta da Cloudflare já vem no formato que `RTCPeerConnection({
 * iceServers })` espera, o backend só repassa.
 *
 * Rate limit por IP (issue #43) — cada chamada gera uma requisição de
 * verdade pra API da Cloudflare, então não é só sobre abuso do nosso
 * servidor, é sobre não estourar quota/custo do provedor por trás. Um
 * cliente legítimo só busca credencial nova ocasionalmente (início de
 * sessão/renovação), não em rajada.
 */
export function registerTurnRoutes(
  app: FastifyInstance,
  turnProvider: TurnCredentialsProvider,
  rateLimits: Pick<AppConfig["rateLimits"], "turn" | "windowMs"> = { turn: DEFAULT_TURN_RATE_LIMIT_MAX, windowMs: DEFAULT_TURN_RATE_LIMIT_WINDOW_MS },
): void {
  app.post(
    "/v1/turn-credentials",
    { config: { rateLimit: { max: rateLimits.turn, timeWindow: rateLimits.windowMs } } },
    async (request, reply) => {
      requireAuth(request);
      const iceServers = await turnProvider.generateIceServers(TURN_CREDENTIALS_TTL_SECONDS);
      reply.code(201);
      return { iceServers, ttlSeconds: TURN_CREDENTIALS_TTL_SECONDS };
    },
  );
}
