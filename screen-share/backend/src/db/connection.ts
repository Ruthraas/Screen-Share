import { createClient, type Client } from "@libsql/client";

/**
 * Abre a conexão com o banco (issue #82: migração de `better-sqlite3` pra
 * Turso/libSQL — decisão registrada em `docs/backend/ARQUITETURA.md`).
 * `url` aceita tanto um caminho local (`file:./data/screenshare.db`,
 * `:memory:` para testes) quanto uma URL real do Turso (`libsql://...`,
 * com `authToken`) — o mesmo cliente libSQL fala os dois, então não existe
 * mais um código de banco separado para teste/produção como antes.
 *
 * Liga a checagem de chaves estrangeiras (desligada por padrão no SQLite)
 * — necessária pro ON DELETE CASCADE de group_members funcionar. `journal_mode
 * = WAL`/`synchronous = NORMAL` (achado real testando capacidade, issue #47)
 * só fazem sentido pra um arquivo local de verdade — num banco remoto do
 * Turso essas duas PRAGMAs não têm efeito (o servidor já cuida disso), por
 * isso o catch: nunca deveria derrubar a conexão por uma PRAGMA que o lado
 * remoto simplesmente ignora ou rejeita.
 */
export async function openDatabase(url: string, authToken?: string): Promise<Client> {
  const client = createClient(authToken ? { url, authToken } : { url });
  await client.execute("PRAGMA foreign_keys = ON");
  try {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = NORMAL");
  } catch {
    // Banco remoto (Turso) — essas PRAGMAs não se aplicam, ignora.
  }
  return client;
}
