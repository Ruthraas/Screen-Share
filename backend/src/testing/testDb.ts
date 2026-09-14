import { createClient, type Client } from "@libsql/client";
import { loadMigrations, migrateUp } from "../db/migrate.js";

/** Banco libSQL em memória, já migrado — só para testes. Mesmo cliente
 * usado em produção (issue #82) — `:memory:` funciona local, sem rede,
 * sem precisar de credencial nenhuma do Turso. */
export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await db.execute("PRAGMA foreign_keys = ON");
  await migrateUp(db, loadMigrations());
  return db;
}
