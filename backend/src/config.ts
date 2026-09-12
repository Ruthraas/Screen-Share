import { z } from "zod";

const REDACTED = "[oculto]";

const envSchema = z
  .object({
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().max(65535).default(8787),

    // Banco (issue #31) — sem valor padrão: exigimos escolha explícita de
    // onde os dados persistem, em vez de gravar num caminho implícito.
    DATABASE_PATH: z
      .string()
      .min(1, "DATABASE_PATH é obrigatória (ex.: ./data/screenshare.db ou :memory: em teste)"),

    // Autenticação (issue #30) — a service account do Firebase Admin é
    // segredo; nunca tem valor padrão.
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
    FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),

    // Sinalização (issue #37/#38) — não é segredo, tem valor padrão seguro.
    SIGNALING_PATH: z.string().min(1).default("/ws"),

    // TURN (issue #40/#41) — segredo usado para gerar credenciais HMAC de
    // curta duração; nunca tem valor padrão.
    TURN_HOST: z.string().min(1, "TURN_HOST é obrigatória"),
    TURN_SECRET: z.string().min(1, "TURN_SECRET é obrigatória"),
  })
  .refine(
    (env) => Boolean(env.FIREBASE_SERVICE_ACCOUNT_PATH || env.FIREBASE_SERVICE_ACCOUNT_JSON),
    {
      message:
        "Defina FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_JSON para verificar tokens",
      path: ["FIREBASE_SERVICE_ACCOUNT_PATH"],
    },
  );

export interface AppConfig {
  host: string;
  port: number;
  database: {
    path: string;
  };
  auth: {
    firebaseServiceAccountPath?: string;
    firebaseServiceAccountJson?: string;
  };
  signaling: {
    path: string;
  };
  turn: {
    host: string;
    secret: string;
  };
}

export class ConfigError extends Error {
  constructor(issues: string[]) {
    super(`Configuração inválida:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
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
      firebaseServiceAccountPath: parsed.FIREBASE_SERVICE_ACCOUNT_PATH,
      firebaseServiceAccountJson: parsed.FIREBASE_SERVICE_ACCOUNT_JSON,
    },
    signaling: {
      path: parsed.SIGNALING_PATH,
    },
    turn: {
      host: parsed.TURN_HOST,
      secret: parsed.TURN_SECRET,
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
      firebaseServiceAccountPath: config.auth.firebaseServiceAccountPath ? REDACTED : undefined,
      firebaseServiceAccountJson: config.auth.firebaseServiceAccountJson ? REDACTED : undefined,
    },
    signaling: { path: config.signaling.path },
    turn: {
      host: config.turn.host,
      secret: REDACTED,
    },
  };
}
