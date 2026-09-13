import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError, UnauthorizedError, NotFoundError } from "../errors.js";
import type { AppConfig } from "../config.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { issueAccessToken, newRefreshTokenValue, hashRefreshToken, REFRESH_TOKEN_TTL_MS } from "../auth/sessionTokens.js";
import { signPayload, verifyPayload, SignatureError } from "../auth/signedPayload.js";
import { OAUTH_PROVIDERS, type OAuthProvider, type OAuthProviderName } from "../auth/oauthProviders.js";
import type { UserRepository } from "../auth/userRepository.js";
import type { AuthIdentity } from "../auth/verifier.js";

const OAUTH_STATE_TTL_MS = 10 * 60_000; // 10 min pra completar o fluxo de redirecionamento.

/**
 * Limites básicos por IP nas rotas de `/v1/auth/*` — as únicas HTTP
 * públicas e sem autenticação do backend, logo as mais expostas a
 * automação (força bruta em login, criação em massa de conta, hammering
 * no `/start`/`/callback` do OAuth, que faz uma chamada de rede de verdade
 * pro provedor). Valores fixos de propósito (mesma filosofia de
 * `OAUTH_STATE_TTL_MS` acima) — não é config de ambiente porque não há
 * cenário legítimo hoje que precise ajustar isso por deploy.
 */
const RATE_LIMITS = {
  register: { max: 5, timeWindow: "1 minute" },
  login: { max: 10, timeWindow: "1 minute" },
  refresh: { max: 30, timeWindow: "1 minute" },
  logout: { max: 30, timeWindow: "1 minute" },
  oauthStart: { max: 20, timeWindow: "1 minute" },
  oauthCallback: { max: 20, timeWindow: "1 minute" },
} as const;

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const logoutSchema = z.object({ refreshToken: z.string().min(1) });

/**
 * Pra onde o resultado do OAuth volta: navegador (fallback de dev,
 * `src/oauth.tsx`) ou app desktop empacotado (deep link `screenshare://`,
 * `src-tauri/src/desktop_auth.rs`). Combinado com o Ruthraas — o cliente já
 * manda `?target=` em `/start` (`buildOAuthStartUrl`/`desktop_oauth_login`);
 * viaja dentro do `state` assinado (não como query no `/callback`, que só
 * recebe de volta o que o provedor ecoa) pra sobreviver à ida-e-volta pelo
 * provedor.
 */
type OAuthTarget = "browser" | "desktop";

function isOAuthTarget(value: unknown): value is OAuthTarget {
  return value === "browser" || value === "desktop";
}

interface OAuthStatePayload {
  provider: OAuthProviderName;
  target: OAuthTarget;
  nonce: string;
  exp: number;
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return result.data;
}

function isOAuthProviderName(value: string): value is OAuthProviderName {
  return value === "google" || value === "github" || value === "discord";
}

/**
 * Rotas de autenticação própria (issue #30) — substituem a verificação de
 * token do Firebase. Todas ficam em `publicPrefixes: ["/v1/auth/"]` no
 * plugin de auth HTTP (não faria sentido exigir sessão pra criar sessão).
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  userRepo: UserRepository,
  authConfig: AppConfig["auth"],
  providers: Record<OAuthProviderName, OAuthProvider> = OAUTH_PROVIDERS,
): void {
  function issueSession(identity: AuthIdentity): { accessToken: string; refreshToken: string } {
    const accessToken = issueAccessToken(identity, authConfig.sessionSigningSecret);
    const refreshValue = newRefreshTokenValue();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
    userRepo.createRefreshToken(identity.uid, hashRefreshToken(refreshValue), expiresAt);
    return { accessToken, refreshToken: refreshValue };
  }

  app.post("/v1/auth/register", { config: { rateLimit: RATE_LIMITS.register } }, async (request, reply) => {
    const body = parseOrThrow(registerSchema, request.body);
    const passwordHash = await hashPassword(body.password, authConfig.passwordPepper);
    const user = userRepo.createWithPassword(body.email, passwordHash);
    reply.code(201);
    return issueSession({ uid: user.id, email: user.email ?? undefined });
  });

  app.post("/v1/auth/login", { config: { rateLimit: RATE_LIMITS.login } }, async (request) => {
    const body = parseOrThrow(loginSchema, request.body);
    const genericError = () => new UnauthorizedError("E-mail ou senha inválidos.");

    const user = userRepo.findByEmail(body.email);
    if (!user || !user.passwordHash) throw genericError();

    const valid = await verifyPassword(body.password, authConfig.passwordPepper, user.passwordHash);
    if (!valid) throw genericError();

    return issueSession({ uid: user.id, email: user.email ?? undefined });
  });

  app.post("/v1/auth/refresh", { config: { rateLimit: RATE_LIMITS.refresh } }, async (request) => {
    const body = parseOrThrow(refreshSchema, request.body);
    const invalid = () => new UnauthorizedError("Refresh token inválido ou expirado.");

    const active = userRepo.findActiveRefreshToken(hashRefreshToken(body.refreshToken));
    if (!active) throw invalid();

    // Rotação: o token usado morre já aqui, mesmo se algo falhar depois.
    userRepo.revokeRefreshToken(active.id);

    const user = userRepo.findById(active.userId);
    if (!user) throw invalid();

    return issueSession({ uid: user.id, email: user.email ?? undefined });
  });

  app.post("/v1/auth/logout", { config: { rateLimit: RATE_LIMITS.logout } }, async (request, reply) => {
    const body = parseOrThrow(logoutSchema, request.body);
    const active = userRepo.findActiveRefreshToken(hashRefreshToken(body.refreshToken));
    // Idempotente: token já revogado/inexistente também responde 204.
    if (active) userRepo.revokeRefreshToken(active.id);
    reply.code(204);
  });

  app.get<{ Params: { provider: string }; Querystring: { target?: string } }>(
    "/v1/auth/oauth/:provider/start",
    { config: { rateLimit: RATE_LIMITS.oauthStart } },
    async (request, reply) => {
      const providerParam = request.params.provider;
      if (!isOAuthProviderName(providerParam)) {
        throw new NotFoundError(`Provedor OAuth "${providerParam}" não existe.`);
      }
      const provider = providers[providerParam];
      const credentials = authConfig.oauthProviders[providerParam];
      if (!credentials) {
        throw new NotFoundError(`Provedor OAuth "${providerParam}" ainda não tem credenciais configuradas.`);
      }

      // `target` é opcional/allowlisted — qualquer valor fora de
      // browser/desktop (ausente incluído) cai no navegador, o
      // comportamento de sempre antes desta mudança.
      const target: OAuthTarget = isOAuthTarget(request.query.target) ? request.query.target : "browser";

      const statePayload: OAuthStatePayload = {
        provider: providerParam,
        target,
        nonce: newRefreshTokenValue(),
        exp: Date.now() + OAUTH_STATE_TTL_MS,
      };
      const state = signPayload(statePayload, authConfig.sessionSigningSecret);
      const redirectUri = `${authConfig.oauthRedirectBaseUrl}/v1/auth/oauth/${providerParam}/callback`;

      reply.redirect(provider.authorizeUrl({ clientId: credentials.clientId, redirectUri, state }), 302);
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    "/v1/auth/oauth/:provider/callback",
    { config: { rateLimit: RATE_LIMITS.oauthCallback } },
    async (request, reply) => {
      const providerParam = request.params.provider;

      // Recupera o `state` o quanto antes, mesmo antes de saber se o resto
      // do pedido é válido: é o único lugar onde `target` sobrevive à
      // ida-e-volta pelo provedor, e sem ele um erro no fluxo desktop
      // voltaria (por padrão) pro navegador dev, quebrando silenciosamente
      // o app empacotado. `state` ausente/adulterado apenas deixa
      // `statePayload` nulo — o erro `invalid_state` de verdade ainda é
      // reportado mais abaixo, na mesma ordem de sempre.
      let statePayload: OAuthStatePayload | null = null;
      try {
        statePayload = verifyPayload<OAuthStatePayload>(request.query.state ?? "", authConfig.sessionSigningSecret);
      } catch (err) {
        if (!(err instanceof SignatureError)) throw err;
      }
      const target: OAuthTarget = statePayload && isOAuthTarget(statePayload.target) ? statePayload.target : "browser";

      function redirectWithError(code: string): void {
        const url = new URL(authConfig.oauthFrontendRedirectUrls[target]);
        url.hash = `error=${encodeURIComponent(code)}`;
        reply.redirect(url.toString(), 302);
      }

      if (!isOAuthProviderName(providerParam)) {
        redirectWithError("provider_unknown");
        return;
      }
      const provider = providers[providerParam];
      const credentials = authConfig.oauthProviders[providerParam];
      if (!credentials) {
        redirectWithError("provider_not_configured");
        return;
      }

      // O provedor pode voltar com ?error=... (ex.: usuário cancelou) — nunca
      // repassar esse valor crú pro cliente.
      if (request.query.error) {
        redirectWithError("provider_error");
        return;
      }

      if (!statePayload || statePayload.provider !== providerParam || statePayload.exp < Date.now()) {
        redirectWithError("invalid_state");
        return;
      }

      if (!request.query.code) {
        redirectWithError("missing_code");
        return;
      }

      try {
        const redirectUri = `${authConfig.oauthRedirectBaseUrl}/v1/auth/oauth/${providerParam}/callback`;
        const providerAccessToken = await provider.exchangeCode({
          code: request.query.code,
          redirectUri,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
        });
        const profile = await provider.fetchProfile(providerAccessToken);
        const user = userRepo.findOrCreateOAuthUser(providerParam, profile.providerAccountId, profile.email);
        const session = issueSession({ uid: user.id, email: user.email ?? undefined });

        const url = new URL(authConfig.oauthFrontendRedirectUrls[target]);
        url.hash = new URLSearchParams({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          provider: providerParam,
        }).toString();
        reply.redirect(url.toString(), 302);
      } catch (err) {
        request.log.error({ err, provider: providerParam }, "oauth: falha ao completar login");
        redirectWithError("provider_error");
      }
    },
  );
}
