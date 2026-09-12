import Database from "better-sqlite3";

/**
 * Abre o banco SQLite e liga a checagem de chaves estrangeiras (desligada
 * por padrão no SQLite) — necessária pro ON DELETE CASCADE de
 * group_members funcionar.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  return db;
}
