import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, type Client } from "@libsql/client";
import { loadMigrations, migrateUp, migrateDownOne } from "./migrate.js";

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await db.execute("PRAGMA foreign_keys = ON");
  return db;
}

async function tableNames(db: Client): Promise<string[]> {
  const rs = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return rs.rows.map((row) => row.name as string);
}

test("migrateUp em banco vazio cria groups, group_members, invites e users", async () => {
  const db = await freshDb();
  const applied = await migrateUp(db, loadMigrations());
  assert.deepEqual(applied, [
    "0001_groups_and_members.sql",
    "0002_invites.sql",
    "0003_users_and_sessions.sql",
    "0004_user_display_profile.sql",
  ]);
  const tables = await tableNames(db);
  assert.ok(tables.includes("groups"));
  assert.ok(tables.includes("group_members"));
  assert.ok(tables.includes("invites"));
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("oauth_accounts"));
  assert.ok(tables.includes("refresh_tokens"));
  const columnsRs = await db.execute("PRAGMA table_info(users)");
  const columns = columnsRs.rows.map((c) => c.name as string);
  assert.ok(columns.includes("display_name"));
  assert.ok(columns.includes("avatar_url"));
  db.close();
});

test("migrateUp é idempotente: rodar de novo não reaplica nem falha", async () => {
  const db = await freshDb();
  const migrations = loadMigrations();
  await migrateUp(db, migrations);
  await db.execute("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')");

  const secondRun = await migrateUp(db, migrations);
  assert.deepEqual(secondRun, []);

  const rs = await db.execute("SELECT COUNT(*) as count FROM groups");
  const row = rs.rows[0] as unknown as { count: number };
  assert.equal(row.count, 1, "dado existente não deve ser afetado por reaplicar migrateUp");
  db.close();
});

test("migrateDownOne desfaz só a última migração aplicada, em ordem reversa", async () => {
  const db = await freshDb();
  const migrations = loadMigrations();
  await migrateUp(db, migrations);

  const undoneFirst = await migrateDownOne(db, migrations);
  assert.equal(undoneFirst, "0004_user_display_profile.sql");
  let columnsRs = await db.execute("PRAGMA table_info(users)");
  let columns = columnsRs.rows.map((c) => c.name as string);
  assert.ok(!columns.includes("display_name"));
  assert.ok(!columns.includes("avatar_url"));
  let tables = await tableNames(db);
  assert.ok(tables.includes("users"), "0003 não deve ser desfeita ainda");

  const undoneSecond = await migrateDownOne(db, migrations);
  assert.equal(undoneSecond, "0003_users_and_sessions.sql");
  tables = await tableNames(db);
  assert.ok(!tables.includes("users"));
  assert.ok(tables.includes("invites"), "0002 não deve ser desfeita ainda");

  const undoneThird = await migrateDownOne(db, migrations);
  assert.equal(undoneThird, "0002_invites.sql");
  tables = await tableNames(db);
  assert.ok(!tables.includes("invites"));
  assert.ok(tables.includes("groups"), "0001 não deve ser desfeita ainda");

  const undoneFourth = await migrateDownOne(db, migrations);
  assert.equal(undoneFourth, "0001_groups_and_members.sql");
  tables = await tableNames(db);
  assert.ok(!tables.includes("groups"));
  assert.ok(!tables.includes("group_members"));
  db.close();
});

test("chave primária composta impede membro duplicado no mesmo grupo", async () => {
  const db = await freshDb();
  await migrateUp(db, loadMigrations());
  await db.execute("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')");
  await db.execute("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','owner')");

  await assert.rejects(
    db.execute("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','member')"),
  );
  db.close();
});

test("excluir o grupo remove seus membros (ON DELETE CASCADE)", async () => {
  const db = await freshDb();
  await migrateUp(db, loadMigrations());
  await db.execute("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')");
  await db.execute("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','owner')");
  await db.execute("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u2','member')");

  await db.execute("DELETE FROM groups WHERE id = 'g1'");

  const rs = await db.execute("SELECT COUNT(*) as count FROM group_members WHERE group_id = 'g1'");
  const remaining = rs.rows[0] as unknown as { count: number };
  assert.equal(remaining.count, 0);
  db.close();
});

test("role fora do conjunto permitido é rejeitada", async () => {
  const db = await freshDb();
  await migrateUp(db, loadMigrations());
  await db.execute("INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','u1')");

  await assert.rejects(
    db.execute("INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','u1','root')"),
  );
  db.close();
});
