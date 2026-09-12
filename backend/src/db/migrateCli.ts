import { loadConfig, ConfigError } from "../config.js";
import { openDatabase } from "./connection.js";
import { migrateUp } from "./migrate.js";

try {
  const config = loadConfig();
  const db = openDatabase(config.database.path);
  const applied = migrateUp(db);
  db.close();

  if (applied.length === 0) {
    console.log("Nenhuma migração pendente.");
  } else {
    console.log(`Migrações aplicadas: ${applied.join(", ")}`);
  }
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
