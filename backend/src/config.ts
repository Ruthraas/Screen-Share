import { z } from "zod";
import type { OAuthProviderName } from "./auth/oauthProviders.js";

const REDACTED = "[oculto]";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65535).default(8787),

  // Banco (issue #31) — sem valor padrão: exigimos escolha explícita de
  // onde os dados persistem, em vez de gravar num caminho implícito.
  DATABASE_PATH: z
    .string()
    .min(1, "DATABASE_PATH é obrigatória (ex.: ./data/screenshare.db ou :memory: em teste)"),

  // Autenticação própria (issue #30) — o Firebase Admin não é mais usado
  // pra verificar identidade. SESSION_SIGNING_SECRET assina access
  // tokens e o `state` do OAuth; PASSWORD_PEPPER entra no hash de senha
  // (issue #29). Nenhum dos dois tem valor padrão — são segredos reais.
  SESSION_SIGNING_SECRET: z.string().min(32, "SESSION_SIGNING_SECRET precisa ter pelo menos 32 caracteres"),
  PASSWORD_PEPPER: z.string().min(16, "PASSWORD_PEPPER precisa ter pelo menos 16 caracteres"),

  // Base pública do próprio backend, usada pra montar o redirect_uri
  // enviado a cada provedor OAuth (precisa bater com o cadastrado lá).
  OAUTH_REDIRECT_BASE_URL: z.string().min(1, "OAUTH_REDIRECT_BASE_URL é obrigatória"),
  // Pra onde o navegador volta depois do fluxo OAuth terminar (sucesso ou
  // erro) — o frontend lê o resultado num fragmento da URL. Tem default
  // porque é uma origem já conhecida deste projeto (dev server do Vite),
  // igual ao CORS_ALLOWED_ORIGINS.
  OAUTH_FRONTEND_REDIRECT_URL: z.string().min(1).default("http://127.0.0.1:5173/oauth.html"),

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

  // TURN (issue #40/#41) — segredo usado para gerar credenciais HMAC de
  // curta duração; nunca tem valor padrão.
  TURN_HOST: z.string().min(1, "TURN_HOST é obrigatória"),
  TURN_SECRET: z.string().min(1, "TURN_SECRET é obrigatória"),

  // CORS (issue #59) — lista separada por vírgula. Padrão são as origens
  // reais deste projeto: o dev server do Vite (vite.config.ts: host
  // 127.0.0.1, porta 5173, igual ao "devUrl" do src-tauri/tauri.conf.json)
  // e a origem do WebView do Tauri 2 empacotado no Windows
  // (https://tauri.localhost — único alvo de bundle hoje é "nsis"). Não é
  // segredo; existe como config só porque pode mudar sem alterar código
  // (ex.: suportar mais uma plataforma de bundle no futuro).
  CORS_ALLOWED_ORIGINS: z.string().min(1).default("http://127.0.0.1:5173,https://tauri.localhost"),
});

export interface OAuthProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  host: string;
  port: number;
  database: {
    path: string;
  };
  auth: {
    sessionSigningSecret: string;
    passwordPepper: string;
    oauthRedirectBaseUrl: string;
    oauthFrontendRedirectUrl: string;
    oauthProviders: Partial<Record<OAuthProviderName, OAuthProviderCredentials>>;
  };
  signaling: {
    path: string;
  };
  turn: {
    host: string;
    secret: string;
  };
  cors: {
    allowedOrigins: string[];
  };
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
    database: {
      path: parsed.DATABASE_PATH,
    },
    auth: {
      sessionSigningSecret: parsed.SESSION_SIGNING_SECRET,
      passwordPepper: parsed.PASSWORD_PEPPER,
      oauthRedirectBaseUrl: parsed.OAUTH_REDIRECT_BASE_URL,
      oauthFrontendRedirectUrl: parsed.OAUTH_FRONTEND_REDIRECT_URL,
      oauthProviders: buildOAuthProviders(parsed),
    },
    signaling: {
      path: parsed.SIGNALING_PATH,
    },
    turn: {
      host: parsed.TURN_HOST,
      secret: parsed.TURN_SECRET,
    },
    cors: {
      allowedOrigins: parsed.CORS_ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    },
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
    database: { path: config.database.path },
    auth: {
      sessionSigningSecret: REDACTED,
      passwordPepper: REDACTED,
      oauthRedirectBaseUrl: config.auth.oauthRedirectBaseUrl,
      oauthFrontendRedirectUrl: config.auth.oauthFrontendRedirectUrl,
      oauthProvidersConfigured: Object.keys(config.auth.oauthProviders),
    },
    signaling: { path: config.signaling.path },
    turn: {
      host: config.turn.host,
      secret: REDACTED,
    },
    cors: { allowedOrigins: config.cors.allowedOrigins },
  };
}
