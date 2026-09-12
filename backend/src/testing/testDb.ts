import Database from "better-sqlite3";
import { loadMigrations, migrateUp } from "../db/migrate.js";

/** Banco SQLite em memória, já migrado — só para testes. */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrateUp(db, loadMigrations());
  return db;
}
