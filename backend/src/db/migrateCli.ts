import { loadConfig, ConfigError } from "../config.js";
import { openDatabase } from "./connection.js";
import { migrateUp } from "./migrate.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDatabase(config.database.url, config.database.authToken);
  const applied = await migrateUp(db);
  db.close();

  if (applied.length === 0) {
    console.log("Nenhuma migração pendente.");
  } else {
    console.log(`Migrações aplicadas: ${applied.join(", ")}`);
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
});
