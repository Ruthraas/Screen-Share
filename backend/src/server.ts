import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerHealthRoutes } from "./routes/health.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerPresenceRoutes } from "./routes/presence.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerTurnRoutes } from "./routes/turn.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { authPlugin } from "./auth/plugin.js";
import type { TokenVerifier } from "./auth/verifier.js";
import { UserRepository } from "./auth/userRepository.js";
import type { OAuthProvider, OAuthProviderName } from "./auth/oauthProviders.js";
import type { TurnCredentialsProvider } from "./turn/cloudflareTurnProvider.js";
import { errorBody } from "./http/errors.js";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, UpstreamError, ValidationError } from "./errors.js";
import { GroupsRepository } from "./groups/repository.js";
import { PresenceStore } from "./presence/store.js";
import { SignalingRooms } from "./signaling/room.js";
import signalingPlugin from "./signaling/plugin.js";
import { ConnectRateLimiter } from "./signaling/connectRateLimiter.js";
import { Metrics } from "./observability/metrics.js";
import type { AppConfig } from "./config.js";
import type Database from "better-sqlite3";

/** Lê `statusCode` de um erro desconhecido (ex.: FastifyError nativo) sem assumir sua forma. */
function statusCodeOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("statusCode" in err)) return undefined;
  const value = (err as { statusCode: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

/** Default só pra quem monta o server sem passar `rateLimits`/`maxBodyBytes`
 * (ex.: testes) — produção sempre recebe os valores de `config.rateLimits`/
 * `config.maxBodyBytes` (issue #43). */
const DEFAULT_RATE_LIMITS: AppConfig["rateLimits"] = {
  windowMs: 60_000,
  register: 5,
  login: 10,
  oauth: 20,
  session: 30,
  turn: 10,
  wsConnect: 20,
};
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export interface BuildServerOptions {
  verifier: TokenVerifier;
  db: Database.Database;
  authConfig: AppConfig["auth"];
  turnProvider: TurnCredentialsProvider;
  corsAllowedOrigins: string[];
  signalingPath: string;
  presence?: PresenceStore;
  rooms?: SignalingRooms;
  /** Issue #43 — configurável via env (RATE_LIMIT_*), default se omitido. */
  rateLimits?: AppConfig["rateLimits"];
  /** Issue #43 — corpo máximo de requisição HTTP, default 1 MiB se omitido. */
  maxBodyBytes?: number;
  /** Issue #44 — contadores/gauges de operação; default cria uma instância nova (perdida no fim do processo, como o resto do estado em memória deste backend). */
  metrics?: Metrics;
  /** Só para testes: intervalo do heartbeat de sinalização (issue #42) — produção usa o default (15s). */
  signalingHeartbeatIntervalMs?: number;
  /** Só para testes que precisam inspecionar log (ex.: confirmar que SDP/ICE não vaza). */
  logger?: FastifyServerOptions["logger"];
  /** Só para testes: injeta providers OAuth falsos em vez dos reais (Google/GitHub/Discord). */
  oauthProviders?: Record<OAuthProviderName, OAuthProvider>;
}

/**
 * Monta a instância do Fastify sem chamar listen() — permite testar rotas
 * via app.inject() sem abrir uma porta real (issue #28, critério de teste).
 * Toda rota HTTP exige token válido (issue #30), exceto /health e
 * /v1/auth/*. A conexão WebSocket de sinalização (issue #37) autentica via
 * query string, já que o navegador não manda header Authorization no
 * handshake de WS.
 */
export function buildServer({
  verifier,
  db,
  authConfig,
  turnProvider,
  corsAllowedOrigins,
  signalingPath,
  presence,
  rooms,
  rateLimits,
  maxBodyBytes,
  metrics,
  signalingHeartbeatIntervalMs,
  logger,
  oauthProviders,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: logger ?? true, bodyLimit: maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES });
  const groupsRepo = new GroupsRepository(db);
  const userRepo = new UserRepository(db);
  const presenceStore = presence ?? new PresenceStore();
  const signalingRooms = rooms ?? new SignalingRooms();
  const rateLimitConfig = rateLimits ?? DEFAULT_RATE_LIMITS;
  const appMetrics = metrics ?? new Metrics();
  const wsConnectRateLimiter = new ConnectRateLimiter(rateLimitConfig.wsConnect, rateLimitConfig.windowMs);

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
  // dentro do plugin de signaling. "/v1/auth/" é público por natureza: são
  // as rotas que criam/renovam/destroem a própria sessão (issue #30).
  // "/ready" e "/metrics" também são públicas — só reportam números
  // operacionais (saúde do banco, contadores), nunca dado de usuário.
  app.register(authPlugin, {
    verifier,
    publicPaths: ["/health", "/ready", "/metrics", signalingPath],
    publicPrefixes: ["/v1/auth/"],
  });
  registerHealthRoutes(app, db);
  registerMetricsRoutes(app, appMetrics);

  // Contagem simples de respostas por classe de status (issue #44 —
  // "métricas mostram conexões/erros"); o detalhe por `code` de erro
  // específico (rate_limited vs upstream_error vs internal_error etc.) é
  // incrementado no setErrorHandler abaixo, onde o code já é conhecido.
  app.addHook("onResponse", (_request, reply, done) => {
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
    appMetrics.increment(`http_responses_total{status_class="${statusClass}"}`);
    done();
  });

  // Rate limit nas rotas de `/v1/auth/*` (únicas públicas e não
  // autenticadas, logo as mais expostas a automação/abuso) e em
  // `/v1/turn-credentials` (autenticada, mas cada chamada gera uma
  // requisição de verdade pra API da Cloudflare — o limite aqui é sobre
  // quota/custo do provedor, não só abuso do nosso servidor) — por isso
  // `rateLimit` entra junto dessas rotas num `register()` encapsulado, em
  // vez de registrar o plugin direto no `app` raiz. Motivo: `config.rateLimit`
  // por rota depende do hook `onRoute`, que só existe depois que o *corpo*
  // do plugin de fato roda — e isso só é garantido esperando o `register()`
  // (via `await` aqui dentro); sem essa espera, as rotas seriam adicionadas
  // antes do hook existir e o limite nunca entraria em vigor (bug real,
  // reproduzido isoladamente antes desta correção). `buildServer()`
  // continua síncrona: quem chama só precisa esperar a instância ficar
  // pronta no primeiro `inject()`/`listen()`, igual a antes.
  // `errorResponseBuilder` devolve o mesmo envelope de erro do resto do
  // contrato (#27) em vez do formato default do plugin.
  app.register(async (rateLimitedScope) => {
    await rateLimitedScope.register(rateLimit, {
      global: false,
      errorResponseBuilder: (_request, context) =>
        new RateLimitedError(`Muitas requisições. Tente novamente em ${context.after}.`),
    });
    registerAuthRoutes(rateLimitedScope, userRepo, authConfig, oauthProviders, rateLimitConfig);
    registerTurnRoutes(rateLimitedScope, turnProvider, rateLimitConfig);
  });

  registerGroupRoutes(app, groupsRepo);
  registerPresenceRoutes(app, groupsRepo, presenceStore);
  app.register(signalingPlugin, {
    path: signalingPath,
    verifier,
    groupsRepo,
    rooms: signalingRooms,
    heartbeatIntervalMs: signalingHeartbeatIntervalMs,
    connectRateLimiter: wsConnectRateLimiter,
    metrics: appMetrics,
  });

  // Mapeia erros de domínio pro envelope de erro único do contrato (#27).
  // Erros não reconhecidos seguem pro handler padrão do Fastify (500).
  // `sendError` centraliza o envio + a métrica por `code` (issue #43/#44 —
  // "métricas distinguem bloqueio de erro interno"): um `errors_total{code=...}`
  // por tipo, incrementado no único lugar que já sabe qual código é.
  function sendError(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string): void {
    appMetrics.increment(`errors_total{code="${code}"}`);
    reply.code(status).send(errorBody(code, message, request.id));
  }

  // Rota que não bate com nenhuma registrada (não confundir com
  // NotFoundError de domínio, ex. "convite não encontrado" — aquele passa
  // pelo setErrorHandler abaixo) — sem isto, o Fastify responde com o
  // shape padrão dele (`{message, error, statusCode}`), não o envelope do
  // contrato (#27), e o erro nunca aparece nas métricas. Achado testando
  // #44 (a suíte só checava o `statusCode`, nunca o corpo, então passava
  // sem perceber a inconsistência).
  app.setNotFoundHandler((request, reply) => {
    sendError(reply, request, 404, "not_found", "Rota não encontrada.");
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ValidationError) {
      sendError(reply, request, 422, "validation_error", err.message);
      return;
    }
    if (err instanceof UnauthorizedError) {
      sendError(reply, request, 401, "unauthorized", err.message);
      return;
    }
    if (err instanceof NotFoundError) {
      sendError(reply, request, 404, "not_found", err.message);
      return;
    }
    if (err instanceof ForbiddenError) {
      sendError(reply, request, 403, "forbidden", err.message);
      return;
    }
    if (err instanceof ConflictError) {
      sendError(reply, request, 409, "conflict", err.message);
      return;
    }
    if (err instanceof RateLimitedError) {
      sendError(reply, request, 429, "rate_limited", err.message);
      return;
    }
    if (err instanceof UpstreamError) {
      request.log.error({ err }, "dependência externa falhou");
      sendError(reply, request, 502, "upstream_error", err.message);
      return;
    }
    // Erro do próprio Fastify (não é uma classe de domínio nossa) que já
    // carrega um status 4xx — ex.: corpo vazio com Content-Type: application/json
    // (FST_ERR_CTP_EMPTY_JSON_BODY), JSON malformado, payload grande demais.
    // Isso é erro de quem chamou, não nosso: respeita o status em vez de
    // cair no 500 genérico abaixo (achado real testando o fluxo completo
    // contra um servidor de verdade — ver docs/backend/TESTE_MANUAL_SINALIZACAO.md).
    const clientErrorStatus = statusCodeOf(err);
    if (clientErrorStatus !== undefined && clientErrorStatus >= 400 && clientErrorStatus < 500) {
      request.log.warn({ err }, "erro de requisição não mapeado por uma classe de domínio");
      sendError(reply, request, clientErrorStatus, "bad_request", "Requisição inválida.");
      return;
    }
    request.log.error({ err }, "erro não tratado");
    sendError(reply, request, 500, "internal_error", "Erro interno.");
  });

  return app;
}
