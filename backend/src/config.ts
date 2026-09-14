import { z } from "zod";
import type { OAuthProviderName } from "./auth/oauthProviders.js";

const REDACTED = "[oculto]";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65535).default(8787),

  // Banco (issue #31, migrado pra Turso/libSQL na issue #82) — dois jeitos
  // de apontar pro banco, mutuamente exclusivos na prática:
  // DATABASE_PATH (arquivo local — dev/teste, ex. ./data/screenshare.db ou
  // :memory:) OU TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (banco remoto de
  // produção, ex. libsql://screenshare-xyz.turso.io). Sem valor padrão pra
  // nenhum dos dois — exigimos escolha explícita de onde os dados
  // persistem, em vez de gravar num caminho implícito. Validado em
  // buildDatabaseConfig() (precisa de pelo menos um dos dois, não dá pra
  // expressar "A ou B obrigatório" só com zod().string() simples aqui).
  DATABASE_PATH: z.string().min(1).optional(),
  TURSO_DATABASE_URL: z.string().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().min(1).optional(),

  // Autenticação própria (issue #30) — o Firebase Admin não é mais usado
  // pra verificar identidade. SESSION_SIGNING_SECRET assina access
  // tokens e o `state` do OAuth; PASSWORD_PEPPER entra no hash de senha
  // (issue #29). Nenhum dos dois tem valor padrão — são segredos reais.
  SESSION_SIGNING_SECRET: z.string().min(32, "SESSION_SIGNING_SECRET precisa ter pelo menos 32 caracteres"),
  PASSWORD_PEPPER: z.string().min(16, "PASSWORD_PEPPER precisa ter pelo menos 16 caracteres"),

  // Base pública do próprio backend, usada pra montar o redirect_uri
  // enviado a cada provedor OAuth (precisa bater com o cadastrado lá).
  OAUTH_REDIRECT_BASE_URL: z.string().min(1, "OAUTH_REDIRECT_BASE_URL é obrigatória"),
  // Pra onde o cliente volta depois do fluxo OAuth terminar (sucesso ou
  // erro) — existem DOIS destinos possíveis, escolhidos pelo `?target=`
  // recebido em `/start` (issue combinada com o Ruthraas, que já manda esse
  // parâmetro do lado do `desktop_auth.rs`/`authClient.ts`): a página de
  // fallback do navegador em dev, ou o deep link `screenshare://` do app
  // empacotado. Ambos têm default porque são origens já conhecidas deste
  // projeto (dev server do Vite / esquema registrado em
  // `src-tauri/tauri.conf.json`), igual ao CORS_ALLOWED_ORIGINS.
  OAUTH_FRONTEND_REDIRECT_URL_BROWSER: z.string().min(1).default("http://127.0.0.1:5173/oauth.html"),
  OAUTH_FRONTEND_REDIRECT_URL_DESKTOP: z.string().min(1).default("screenshare://oauth-callback"),

  // Credenciais por provedor — opcionais de propósito: as reais ainda não
  // existem (dependem de cadastro nas consoles de cada plataforma), e o
  // backend precisa subir mesmo sem elas. Sem client id/secret, o
  // /start daquele provedor responde erro claro em vez de travar o boot.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),

  // Sinalização (issue #37/#38) — não é segredo, tem valor padrão seguro.
  SIGNALING_PATH: z.string().min(1).default("/ws"),

  // TURN (issue #40/#41) — Cloudflare Realtime TURN (serviço gerenciado,
  // decisão registrada em docs/backend/ARQUITETURA.md), não um coturn
  // autogerenciado. TURN_KEY_ID identifica a chave TURN (visível, entra na
  // própria URL da API da Cloudflare — mesmo status de um client_id, não é
  // segredo); TURN_KEY_API_TOKEN é o segredo de servidor usado só aqui pra
  // gerar credenciais de curta duração, nunca enviado ao cliente. Nenhum
  // dos dois tem valor padrão.
  TURN_KEY_ID: z.string().min(1, "TURN_KEY_ID é obrigatória"),
  TURN_KEY_API_TOKEN: z.string().min(1, "TURN_KEY_API_TOKEN é obrigatória"),

  // CORS (issue #59) — lista separada por vírgula. Padrão são as origens
  // reais deste projeto: o dev server do Vite (vite.config.ts: host
  // 127.0.0.1, porta 5173, igual ao "devUrl" do src-tauri/tauri.conf.json)
  // e a origem do WebView do Tauri 2 empacotado no Windows. Precisa dos
  // DOIS esquemas do WebView2 (issue #69, achado testando o .exe de
  // verdade): `https://tauri.localhost` é o documentado, mas o WebView2
  // manda `http://tauri.localhost` (sem HTTPS) em algumas versões/config —
  // sem os dois, o preflight OPTIONS cai no onRequest de auth (401) em vez
  // do @fastify/cors interceptar, porque a origem não bate com a
  // allowlist. Não é segredo; existe como config só porque pode mudar sem
  // alterar código (ex.: suportar mais uma plataforma de bundle no futuro).
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .default("http://127.0.0.1:5173,https://tauri.localhost,http://tauri.localhost"),

  // Limites de uso/anti-abuso (issue #43) — configuráveis (critério de
  // aceite explícito da issue), mas com default igual ao que já estava
  // hardcoded antes: nenhum comportamento muda pra quem não define nada.
  // Uma janela só (`RATE_LIMIT_WINDOW_MS`) compartilhada por todos os
  // limites — variar a janela por rota também, além do máximo, multiplica
  // combinações sem ganho real pra uma equipe de 2 pessoas.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_OAUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_SESSION_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_TURN_MAX: z.coerce.number().int().positive().default(10),
  // Conexões WS (não HTTP — enforçado com um limitador próprio em
  // src/signaling/connectRateLimiter.ts, não pelo @fastify/rate-limit) —
  // mesma janela, limite próprio porque a natureza do abuso é diferente
  // (tentativa de handshake, não requisição HTTP completa).
  RATE_LIMIT_WS_CONNECT_MAX: z.coerce.number().int().positive().default(20),

  // Corpo máximo de requisição HTTP (issue #43, "limites de payload") —
  // default é o mesmo já embutido no Fastify (1 MiB); só explicitamos e
  // deixamos configurável em vez de depender de um default implícito.
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
});

export interface OAuthProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  host: string;
  port: number;
  database: {
    url: string;
    authToken?: string;
  };
  auth: {
    sessionSigningSecret: string;
    passwordPepper: string;
    oauthRedirectBaseUrl: string;
    oauthFrontendRedirectUrls: { browser: string; desktop: string };
    oauthProviders: Partial<Record<OAuthProviderName, OAuthProviderCredentials>>;
  };
  signaling: {
    path: string;
  };
  turn: {
    keyId: string;
    apiToken: string;
  };
  cors: {
    allowedOrigins: string[];
  };
  rateLimits: {
    windowMs: number;
    register: number;
    login: number;
    oauth: number;
    session: number;
    turn: number;
    wsConnect: number;
  };
  maxBodyBytes: number;
}

export class ConfigError extends Error {
  constructor(issues: string[]) {
    super(`Configuração inválida:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

function buildOAuthProviders(parsed: z.infer<typeof envSchema>): AppConfig["auth"]["oauthProviders"] {
  const providers: AppConfig["auth"]["oauthProviders"] = {};
  if (parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET) {
    providers.google = { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET };
  }
  if (parsed.GITHUB_CLIENT_ID && parsed.GITHUB_CLIENT_SECRET) {
    providers.github = { clientId: parsed.GITHUB_CLIENT_ID, clientSecret: parsed.GITHUB_CLIENT_SECRET };
  }
  if (parsed.DISCORD_CLIENT_ID && parsed.DISCORD_CLIENT_SECRET) {
    providers.discord = { clientId: parsed.DISCORD_CLIENT_ID, clientSecret: parsed.DISCORD_CLIENT_SECRET };
  }
  return providers;
}

/** Resolve a URL de conexão do banco (issue #82) a partir de
 * TURSO_DATABASE_URL (produção) ou DATABASE_PATH (dev/teste, arquivo
 * local ou `:memory:`) — o primeiro que existir vence; erro claro se
 * nenhum dos dois foi configurado. `DATABASE_PATH` vira uma URL `file:`
 * automaticamente quando ainda não parece uma (aceita path relativo
 * simples, do jeito que já era usado antes desta issue). */
function buildDatabaseConfig(parsed: z.infer<typeof envSchema>): AppConfig["database"] {
  if (parsed.TURSO_DATABASE_URL) {
    return { url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN };
  }
  if (parsed.DATABASE_PATH) {
    const path = parsed.DATABASE_PATH;
    const url = path === ":memory:" || path.includes("://") || path.startsWith("file:") ? path : `file:${path}`;
    return { url };
  }
  throw new ConfigError(["DATABASE_PATH ou TURSO_DATABASE_URL: pelo menos um dos dois é obrigatório"]);
}

/**
 * Carrega e valida a configuração a partir do ambiente. Lança ConfigError
 * com uma mensagem clara (uma linha por problema) quando algo obrigatório
 * falta ou é inválido — issue #29, critério de aceite.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(config)"}: ${issue.message}`);
    throw new ConfigError(issues);
  }

  const parsed = result.data;
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    database: buildDatabaseConfig(parsed),
    auth: {
      sessionSigningSecret: parsed.SESSION_SIGNING_SECRET,
      passwordPepper: parsed.PASSWORD_PEPPER,
      oauthRedirectBaseUrl: parsed.OAUTH_REDIRECT_BASE_URL,
      oauthFrontendRedirectUrls: {
        browser: parsed.OAUTH_FRONTEND_REDIRECT_URL_BROWSER,
        desktop: parsed.OAUTH_FRONTEND_REDIRECT_URL_DESKTOP,
      },
      oauthProviders: buildOAuthProviders(parsed),
    },
    signaling: {
      path: parsed.SIGNALING_PATH,
    },
    turn: {
      keyId: parsed.TURN_KEY_ID,
      apiToken: parsed.TURN_KEY_API_TOKEN,
    },
    cors: {
      allowedOrigins: parsed.CORS_ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    },
    rateLimits: {
      windowMs: parsed.RATE_LIMIT_WINDOW_MS,
      register: parsed.RATE_LIMIT_REGISTER_MAX,
      login: parsed.RATE_LIMIT_LOGIN_MAX,
      oauth: parsed.RATE_LIMIT_OAUTH_MAX,
      session: parsed.RATE_LIMIT_SESSION_MAX,
      turn: parsed.RATE_LIMIT_TURN_MAX,
      wsConnect: parsed.RATE_LIMIT_WS_CONNECT_MAX,
    },
    maxBodyBytes: parsed.MAX_BODY_BYTES,
  };
}

/**
 * Versão da configuração segura para logar: nenhum segredo aparece em
 * texto puro (issue #29, "logs ocultam segredos"). Usar sempre isto em vez
 * do AppConfig bruto ao logar.
 */
export function toPublicSummary(config: AppConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    database: { url: config.database.url, authToken: config.database.authToken ? REDACTED : undefined },
    auth: {
      sessionSigningSecret: REDACTED,
      passwordPepper: REDACTED,
      oauthRedirectBaseUrl: config.auth.oauthRedirectBaseUrl,
      oauthFrontendRedirectUrls: config.auth.oauthFrontendRedirectUrls,
      oauthProvidersConfigured: Object.keys(config.auth.oauthProviders),
    },
    signaling: { path: config.signaling.path },
    turn: {
      keyId: config.turn.keyId,
      apiToken: REDACTED,
    },
    cors: { allowedOrigins: config.cors.allowedOrigins },
    rateLimits: config.rateLimits,
    maxBodyBytes: config.maxBodyBytes,
  };
}
