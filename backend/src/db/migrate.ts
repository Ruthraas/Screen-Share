import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

export interface Migration {
  id: string;
  up: string;
  down: string;
}

function parseMigration(id: string, content: string): Migration {
  const upMarker = "-- up";
  const downMarker = "-- down";
  const upIndex = content.indexOf(upMarker);
  const downIndex = content.indexOf(downMarker);
  if (upIndex === -1 || downIndex === -1 || downIndex < upIndex) {
    throw new Error(`Migração "${id}" inválida: precisa dos marcadores "-- up" e "-- down"`);
  }
  return {
    id,
    up: content.slice(upIndex + upMarker.length, downIndex).trim(),
    down: content.slice(downIndex + downMarker.length).trim(),
  };
}

/** Carrega as migrações do diretório, ordenadas pelo nome do arquivo (prefixo numérico). */
export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => parseMigration(file, readFileSync(path.join(dir, file), "utf-8")));
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

/** Aplica as migrações ainda não registradas em _migrations, em ordem. Idempotente. */
export function migrateUp(db: Database.Database, migrations: Migration[] = loadMigrations()): string[] {
  ensureMigrationsTable(db);
  const applied = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: string }[]).map((row) => row.id),
  );

  const appliedNow: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec(migration.up);
    db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(migration.id);
    appliedNow.push(migration.id);
  }
  return appliedNow;
}

/** Desfaz só a última migração aplicada. Retorna o id desfeito, ou undefined se não havia nenhuma. */
export function migrateDownOne(db: Database.Database, migrations: Migration[] = loadMigrations()): string | undefined {
  ensureMigrationsTable(db);
  const last = db.prepare("SELECT id FROM _migrations ORDER BY id DESC LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (!last) return undefined;

  const migration = migrations.find((m) => m.id === last.id);
  if (!migration) {
    throw new Error(`Migração aplicada "${last.id}" não foi encontrada no diretório de migrações`);
  }

  db.exec(migration.down);
  db.prepare("DELETE FROM _migrations WHERE id = ?").run(migration.id);
  return migration.id;
}
