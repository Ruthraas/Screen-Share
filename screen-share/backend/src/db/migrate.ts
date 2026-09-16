import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";

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

async function ensureMigrationsTable(db: Client): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

/** Aplica as migrações ainda não registradas em _migrations, em ordem. Idempotente. */
export async function migrateUp(db: Client, migrations: Migration[] = loadMigrations()): Promise<string[]> {
  await ensureMigrationsTable(db);
  const applied = new Set(
    (await db.execute("SELECT id FROM _migrations")).rows.map((row) => row.id as string),
  );

  const appliedNow: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await db.executeMultiple(migration.up);
    await db.execute({ sql: "INSERT INTO _migrations (id) VALUES (?)", args: [migration.id] });
    appliedNow.push(migration.id);
  }
  return appliedNow;
}

/** Desfaz só a última migração aplicada. Retorna o id desfeito, ou undefined se não havia nenhuma. */
export async function migrateDownOne(db: Client, migrations: Migration[] = loadMigrations()): Promise<string | undefined> {
  await ensureMigrationsTable(db);
  const lastRow = (await db.execute("SELECT id FROM _migrations ORDER BY id DESC LIMIT 1")).rows[0];
  if (!lastRow) return undefined;
  const lastId = lastRow.id as string;

  const migration = migrations.find((m) => m.id === lastId);
  if (!migration) {
    throw new Error(`Migração aplicada "${lastId}" não foi encontrada no diretório de migrações`);
  }

  await db.executeMultiple(migration.down);
  await db.execute({ sql: "DELETE FROM _migrations WHERE id = ?", args: [migration.id] });
  return migration.id;
}
