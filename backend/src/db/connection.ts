import Database from "better-sqlite3";

/**
 * Abre o banco SQLite e liga a checagem de chaves estrangeiras (desligada
 * por padrão no SQLite) — necessária pro ON DELETE CASCADE de
 * group_members funcionar.
 *
 * `journal_mode = WAL` (issue #47, achado real testando capacidade): sem
 * WAL, o modo padrão (rollback journal) recria/apaga um arquivo de
 * journal a cada transação de escrita, e escrita ficou visivelmente
 * super-linear (500 registros sequenciais foram de ~10s pros primeiros
 * 100 pra ~147s no total — não é o esperado pra um SELECT indexado +
 * INSERT). Trocar pra WAL (uma escrita append-only no `-wal`, sem recriar
 * arquivo) resolveu — ver docs/backend/ARQUITETURA.md. `synchronous =
 * NORMAL` é o pareamento padrão recomendado com WAL: ainda seguro contra
 * corrupção (o WAL garante isso sozinho), só relaxa o fsync a cada
 * transação. `:memory:` (usado em teste) não tem arquivo, então WAL não
 * se aplica — better-sqlite3 ignora o pragma nesse caso sem erro.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}
