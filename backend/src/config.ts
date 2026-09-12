export interface AppConfig {
  host: string;
  port: number;
}

/**
 * Configuração mínima para o serviço subir (host/porta). Segredos e schema
 * validado por ambiente ficam na issue #29 — este módulo não lê nada
 * sensível de propósito.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.PORT ?? "8787";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT inválida: "${rawPort}"`);
  }

  return {
    host: env.HOST ?? "0.0.0.0",
    port,
  };
}
