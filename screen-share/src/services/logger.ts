/**
 * Camada de log de diagnóstico do cliente (issue #23) — autenticação,
 * navegação desktop (fluxo OAuth via deep link) e falhas de captura de
 * stream. Nunca envia nada pra fora do processo (sem telemetria remota,
 * só `console.*`); redige qualquer campo cujo nome pareça sensível antes de
 * imprimir, então quem loga não precisa filtrar manualmente a cada chamada.
 */
export type LogScope = "auth" | "desktop" | "capture" | "rtc" | "update";
type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

/** Nomes de campo tratados como sensíveis em qualquer profundidade do
 * contexto — nunca a mensagem inteira, só os valores desses campos. Cobre
 * senha, token (acesso/refresh, com ou sem underscore), código OAuth,
 * cabeçalho de autorização e e-mail (a validação obrigatória da issue #23
 * pede explicitamente pra garantir que e-mails de teste não vazem nos
 * logs, não só tokens); propositalmente NÃO cobre `code` sozinho porque é
 * o nome usado pros códigos de erro seguros (`AuthError.code`,
 * `desktop-auth-timeout` etc.) que o critério de aceite pede pra manter. */
const SENSITIVE_KEY = /senha|password|token|secret|authorization|oauth[_-]?code|e-?mail/i;

function redactValue(value: unknown, depth: number): unknown {
  if (depth <= 0) return "[omitido: profundidade maxima]";
  if (Array.isArray(value)) return value.map(item => redactValue(item, depth - 1));
  if (value && typeof value === "object") return redactContext(value as LogContext, depth - 1);
  return value;
}

/** Exportado só pra teste unitário direto da regra de redação (sem precisar
 * de um browser/console real pra validar que nada sensível escapa). */
export function redactContext(context: LogContext, depth = 4): LogContext {
  const safe: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    safe[key] = SENSITIVE_KEY.test(key) ? "[omitido]" : redactValue(value, depth);
  }
  return safe;
}

/** `import.meta.env` não existe fora do Vite (`node --test`) — trata como
 * produção nesse caso (silencioso por padrão é mais seguro que verboso). */
function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function emit(level: LogLevel, scope: LogScope, message: string, context?: LogContext): void {
  // Produção não exibe debug/info (critério de aceite: "producao nao exibe
  // debug excessivo") — warn/error continuam, são o que importa pra
  // diagnosticar um usuário real que não tem console aberto do dev.
  if (!isDev() && (level === "debug" || level === "info")) return;
  const prefix = `[${scope}]`;
  const safeContext = context ? redactContext(context) : undefined;
  // Chama `console[level](...)` na própria expressão (não extrai `fn` numa
  // variável antes) — assim `this` continua sendo `console` na chamada
  // real (métodos nativos do console dependem disso), e ainda lê o valor
  // atual de `console[level]` a cada chamada, então um teste que substitui
  // `console.warn` etc. depois do import continua funcionando.
  if (safeContext) console[level](prefix, message, safeContext);
  else console[level](prefix, message);
}

export const log = {
  debug: (scope: LogScope, message: string, context?: LogContext) => emit("debug", scope, message, context),
  info: (scope: LogScope, message: string, context?: LogContext) => emit("info", scope, message, context),
  warn: (scope: LogScope, message: string, context?: LogContext) => emit("warn", scope, message, context),
  error: (scope: LogScope, message: string, context?: LogContext) => emit("error", scope, message, context),
};
