import { buildServer } from "./server.js";
import { loadConfig, toPublicSummary, ConfigError } from "./config.js";
import { SessionTokenVerifier } from "./auth/sessionTokenVerifier.js";
import { openDatabase } from "./db/connection.js";
import { migrateUp } from "./db/migrate.js";

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

  const db = openDatabase(config.database.path);
  const applied = migrateUp(db);

  const verifier = new SessionTokenVerifier(config.auth.sessionSigningSecret);
  const app = buildServer({
    verifier,
    db,
    authConfig: config.auth,
    corsAllowedOrigins: config.cors.allowedOrigins,
    signalingPath: config.signaling.path,
  });
  app.log.info({ config: toPublicSummary(config), migrationsApplied: applied }, "configuração carregada");

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
