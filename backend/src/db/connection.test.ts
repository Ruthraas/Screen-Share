import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "./connection.js";

test("openDatabase liga foreign_keys, WAL e synchronous=NORMAL (issue #47 — achado real de performance)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "screenshare-db-test-"));
  const dbPath = path.join(dir, "test.db");
  const db = openDatabase(dbPath);
  try {
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("synchronous", { simple: true }), 1); // NORMAL = 1 no enum interno do SQLite
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
