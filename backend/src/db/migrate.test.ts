import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { loadMigrations, migrateUp, migrateDownOne } from "./migrate.js";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (row) => row.name,
  );
}

test("migrateUp em banco vazio cria groups e group_members", () => {
  const db = freshDb();
  const applied = migrateUp(db, loadMigrations());
  assert.deepEqual(applied, ["0001_groups_and_members.sql"]);
  const tables = tableNames(db);
  assert.ok(tables.includes("groups"));
  assert.ok(tables.includes("group_members"));
  db.close();
});

test("migrateUp é idempotente: rodar de novo não reaplica nem falha", () => {
  const db = freshDb();
  const migrations = loadMigrations();
  migrateUp(db, migrations);
  db.prepare("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')").run();

  const secondRun = migrateUp(db, migrations);
  assert.deepEqual(secondRun, []);

  const row = db.prepare("SELECT COUNT(*) as count FROM groups").get() as { count: number };
  assert.equal(row.count, 1, "dado existente não deve ser afetado por reaplicar migrateUp");
  db.close();
});

test("migrateDownOne desfaz a última migração e remove as tabelas", () => {
  const db = freshDb();
  const migrations = loadMigrations();
  migrateUp(db, migrations);

  const undone = migrateDownOne(db, migrations);
  assert.equal(undone, "0001_groups_and_members.sql");

  const tables = tableNames(db);
  assert.ok(!tables.includes("groups"));
  assert.ok(!tables.includes("group_members"));
  db.close();
});

test("chave primária composta impede membro duplicado no mesmo grupo", () => {
  const db = freshDb();
  migrateUp(db, loadMigrations());
  db.prepare("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','owner')").run();

  assert.throws(() => {
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','member')").run();
  });
  db.close();
});

test("excluir o grupo remove seus membros (ON DELETE CASCADE)", () => {
  const db = freshDb();
  migrateUp(db, loadMigrations());
  db.prepare("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','owner')").run();
  db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u2','member')").run();

  db.prepare("DELETE FROM groups WHERE id = 'g1'").run();

  const remaining = db.prepare("SELECT COUNT(*) as count FROM group_members WHERE group_id = 'g1'").get() as {
    count: number;
  };
  assert.equal(remaining.count, 0);
  db.close();
});

test("role fora do conjunto permitido é rejeitada", () => {
  const db = freshDb();
  migrateUp(db, loadMigrations());
  db.prepare("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')").run();

  assert.throws(() => {
    db.prepare("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','root')").run();
  });
  db.close();
});
