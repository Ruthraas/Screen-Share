import { buildServer } from "./server.js";
import { loadConfig, toPublicSummary, ConfigError } from "./config.js";
import { SessionTokenVerifier } from "./auth/sessionTokenVerifier.js";
import { openDatabase } from "./db/connection.js";
import { migrateUp } from "./db/migrate.js";
import { cloudflareTurnProvider } from "./turn/cloudflareTurnProvider.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const db = await openDatabase(config.database.url, config.database.authToken);
  const applied = await migrateUp(db);

  const verifier = new SessionTokenVerifier(config.auth.sessionSigningSecret);
  const turnProvider = cloudflareTurnProvider(config.turn.keyId, config.turn.apiToken);
  const app = buildServer({
    verifier,
    db,
    authConfig: config.auth,
    turnProvider,
    corsAllowedOrigins: config.cors.allowedOrigins,
    signalingPath: config.signaling.path,
    rateLimits: config.rateLimits,
    maxBodyBytes: config.maxBodyBytes,
  });
  app.log.info({ config: toPublicSummary(config), migrationsApplied: applied }, "configuração carregada");

  // Rede de seguranca (achado real: signaling/plugin.ts tinha exatamente
  // esse buraco ate agora - um listener de evento cru do `ws`, fora do
  // ciclo de vida de erro do Fastify, cuja promise rejeitada nunca era
  // tratada). Registrar este handler muda o comportamento padrao do Node
  // (que e derrubar o processo numa unhandled rejection) - preferimos
  // manter o processo de pe pra nao tirar TODO MUNDO do ar por causa de
  // uma falha isolada, mesmo que ela indique um bug real que merece
  // try/catch no lugar certo. Nunca deveria ser a UNICA linha de defesa
  // (o fix cirurgico no listener continua sendo o certo), so a ultima.
  process.on("unhandledRejection", (reason) => {
    app.log.error({ err: reason }, "unhandledRejection nao tratada - processo continua de pe, mas isto indica um bug real (falta try/catch em algum ponto)");
  });
  // Diferente de unhandledRejection: uma excecao sincrona nao capturada
  // pode deixar o processo num estado inconsistente (memoria/handles
  // parcialmente mutados no meio de uma operacao) - mais seguro reiniciar
  // limpo (Render reinicia sozinho) do que continuar de pe adivinhando.
  process.on("uncaughtException", (err) => {
    app.log.error({ err }, "uncaughtException - encerrando processo pra reiniciar limpo");
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "encerrando servidor");
    try {
      await app.close();
      db.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "erro ao encerrar servidor");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
