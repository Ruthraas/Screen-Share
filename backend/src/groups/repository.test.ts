import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupsRepository } from "./repository.js";
import { UserRepository } from "../auth/userRepository.js";
import { createTestDb } from "../testing/testDb.js";

test("getGroupForUser devolve displayName/avatarUrl reais de outros membros (issue #70 nunca exposta aqui)", async () => {
  const db = await createTestDb();
  const users = new UserRepository(db);
  const groups = new GroupsRepository(db);

  const owner = await users.findOrCreateOAuthUser("google", "google-owner", "owner@example.com", {
    displayName: "Fulano de Tal",
    avatarUrl: "https://lh3.googleusercontent.com/foto.jpg",
  });
  const passwordOnly = await users.createWithPassword("senha@example.com", "hash-qualquer");

  const group = await groups.createGroup("Equipe", owner.id);
  const invite = await groups.createInvite(group.id, owner.id, 60, 5);
  await groups.acceptInvite(invite.token, passwordOnly.id);

  const detailAsOwner = await groups.getGroupForUser(group.id, owner.id);
  const seenPasswordOnly = detailAsOwner!.members.find((m) => m.userId === passwordOnly.id);
  assert.equal(seenPasswordOnly?.displayName, undefined, "conta só-senha nunca setou nome — undefined, não um rótulo inventado aqui");
  assert.equal(seenPasswordOnly?.avatarUrl, undefined);

  const detailAsPasswordOnly = await groups.getGroupForUser(group.id, passwordOnly.id);
  const seenOwner = detailAsPasswordOnly!.members.find((m) => m.userId === owner.id);
  assert.equal(seenOwner?.displayName, "Fulano de Tal", "outro membro (não o próprio usuário) precisa ver o nome real");
  assert.equal(seenOwner?.avatarUrl, "https://lh3.googleusercontent.com/foto.jpg");
});

test("getGroupForUser não derruba membros sem linha em users (LEFT JOIN, não INNER)", async () => {
  const db = await createTestDb();
  const groups = new GroupsRepository(db);
  // Sem UserRepository aqui de propósito: simula um group_members com um
  // user_id que não existe em `users` — cenário real de teste (FakeTokenVerifier
  // não cria linha em `users`) e defesa contra um INNER JOIN silenciosamente
  // apagar membros inteiros da resposta em vez de só vir sem nome.
  await db.execute({ sql: "INSERT INTO groups (id, name, owner_id) VALUES ('g1','Equipe','sem-linha-em-users')", args: [] });
  await db.execute({ sql: "INSERT INTO group_members (group_id, user_id, role) VALUES ('g1','sem-linha-em-users','owner')", args: [] });

  const detail = await groups.getGroupForUser("g1", "sem-linha-em-users");
  assert.equal(detail!.members.length, 1, "membro sem linha em users ainda precisa aparecer na lista");
  assert.equal(detail!.members[0].displayName, undefined);
});
