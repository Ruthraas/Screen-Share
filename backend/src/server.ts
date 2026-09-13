import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerHealthRoutes } from "./routes/health.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerPresenceRoutes } from "./routes/presence.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { authPlugin } from "./auth/plugin.js";
import type { TokenVerifier } from "./auth/verifier.js";
import { UserRepository } from "./auth/userRepository.js";
import type { OAuthProvider, OAuthProviderName } from "./auth/oauthProviders.js";
import { errorBody } from "./http/errors.js";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError, ValidationError } from "./errors.js";
import { GroupsRepository } from "./groups/repository.js";
import { PresenceStore } from "./presence/store.js";
import { SignalingRooms } from "./signaling/room.js";
import signalingPlugin from "./signaling/plugin.js";
import type { AppConfig } from "./config.js";
import type Database from "better-sqlite3";

export interface BuildServerOptions {
  verifier: TokenVerifier;
  db: Database.Database;
  authConfig: AppConfig["auth"];
  corsAllowedOrigins: string[];
  signalingPath: string;
  presence?: PresenceStore;
  rooms?: SignalingRooms;
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
  corsAllowedOrigins,
  signalingPath,
  presence,
  rooms,
  logger,
  oauthProviders,
}: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: logger ?? true });
  const groupsRepo = new GroupsRepository(db);
  const userRepo = new UserRepository(db);
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
  // dentro do plugin de signaling. "/v1/auth/" é público por natureza: são
  // as rotas que criam/renovam/destroem a própria sessão (issue #30).
  // "/ready" também é público — só reporta saúde do banco, não expõe nada
  // sensível.
  app.register(authPlugin, {
    verifier,
    publicPaths: ["/health", "/ready", signalingPath],
    publicPrefixes: ["/v1/auth/"],
  });
  registerHealthRoutes(app, db);

  // Rate limit só nas rotas de `/v1/auth/*` (únicas públicas e não
  // autenticadas, logo as mais expostas a automação/abuso) — por isso
  // `rateLimit` e `registerAuthRoutes` entram juntos num `register()`
  // encapsulado, em vez de registrar o plugin direto no `app` raiz.
  // Motivo: `config.rateLimit` por rota depende do hook `onRoute`, que só
  // existe depois que o *corpo* do plugin de fato roda — e isso só é
  // garantido esperando o `register()` (via `await` aqui dentro); sem essa
  // espera, as rotas seriam adicionadas antes do hook existir e o limite
  // nunca entraria em vigor (bug real, reproduzido isoladamente antes desta
  // correção). `buildServer()` continua síncrona: quem chama só precisa
  // esperar a instância ficar pronta no primeiro `inject()`/`listen()`,
  // igual a antes. `errorResponseBuilder` devolve o mesmo envelope de erro
  // do resto do contrato (#27) em vez do formato default do plugin.
  app.register(async (authScope) => {
    await authScope.register(rateLimit, {
      global: false,
      errorResponseBuilder: (_request, context) =>
        new RateLimitedError(`Muitas requisições. Tente novamente em ${context.after}.`),
    });
    registerAuthRoutes(authScope, userRepo, authConfig, oauthProviders);
  });

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
    if (err instanceof UnauthorizedError) {
      reply.code(401).send(errorBody("unauthorized", err.message, request.id));
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
    if (err instanceof RateLimitedError) {
      reply.code(429).send(errorBody("rate_limited", err.message, request.id));
      return;
    }
    request.log.error({ err }, "erro não tratado");
    reply.code(500).send(errorBody("internal_error", "Erro interno.", request.id));
  });

  return app;
}
