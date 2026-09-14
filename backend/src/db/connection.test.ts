import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase } from "./connection.js";

// No Windows, o binding nativo do libSQL solta o handle do arquivo (e dos
// sidecars -wal/-shm) um instante depois de close() retornar — rmSync
// imediato às vezes esbarra em EPERM. Não acontece em produção (nada lá
// apaga o arquivo do banco); é só limpeza de teste, por isso a retentativa
// curta em vez de mudar o comportamento de openDatabase/close.
async function rmDirWithRetry(dir: string): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPERM") throw err;
      if (attempt === maxAttempts - 1) {
        // Best-effort: é só um diretório temporário de teste, o SO limpa
        // sozinho eventualmente — não vale falhar o teste por causa disso
        // depois que as asserções reais já passaram.
        return;
      }
      await delay(50 * (attempt + 1));
    }
  }
}

async function pragma(db: Awaited<ReturnType<typeof openDatabase>>, name: string): Promise<unknown> {
  const rs = await db.execute(`PRAGMA ${name}`);
  const row = rs.rows[0] as unknown as Record<string, unknown>;
  return row[Object.keys(row)[0]];
}

test("openDatabase liga foreign_keys, WAL e synchronous=NORMAL (issue #47 — achado real de performance)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "screenshare-db-test-"));
  const dbPath = path.join(dir, "test.db");
  const db = await openDatabase(`file:${dbPath}`);
  try {
    assert.equal(await pragma(db, "foreign_keys"), 1);
    assert.equal(await pragma(db, "journal_mode"), "wal");
    assert.equal(await pragma(db, "synchronous"), 1); // NORMAL = 1 no enum interno do SQLite
  } finally {
    db.close();
    await rmDirWithRetry(dir);
  }
});

test("openDatabase funciona com banco em memória (usado nos testes)", async () => {
  const db = await openDatabase(":memory:");
  try {
    assert.equal(await pragma(db, "foreign_keys"), 1);
  } finally {
    db.close();
  }
});
