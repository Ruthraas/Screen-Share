import { test } from "node:test";
import assert from "node:assert/strict";
import { UserRepository } from "./userRepository.js";
import { createTestDb } from "../testing/testDb.js";
import { ConflictError } from "../errors.js";

test("createWithPassword cria usuário e rejeita e-mail duplicado", async () => {
  const repo = new UserRepository(await createTestDb());
  const user = await repo.createWithPassword("a@b.com", "hash1");
  assert.equal(user.email, "a@b.com");

  await assert.rejects(repo.createWithPassword("a@b.com", "hash2"), ConflictError);
});

test("findByEmail devolve o password_hash pra verificação", async () => {
  const repo = new UserRepository(await createTestDb());
  await repo.createWithPassword("a@b.com", "hash-armazenado");
  const found = await repo.findByEmail("a@b.com");
  assert.equal(found?.passwordHash, "hash-armazenado");
});

test("findOrCreateOAuthUser cria usuário novo na primeira vez", async () => {
  const repo = new UserRepository(await createTestDb());
  const user = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com");
  assert.equal(user.email, "a@b.com");
});

test("findOrCreateOAuthUser é idempotente pro mesmo provider+conta", async () => {
  const repo = new UserRepository(await createTestDb());
  const first = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com");
  const second = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com");
  assert.equal(first.id, second.id);
});

test("findOrCreateOAuthUser vincula a uma conta de senha existente com o mesmo e-mail", async () => {
  const repo = new UserRepository(await createTestDb());
  const passwordUser = await repo.createWithPassword("a@b.com", "hash1");
  const oauthUser = await repo.findOrCreateOAuthUser("github", "gh-456", "a@b.com");
  assert.equal(oauthUser.id, passwordUser.id, "deve linkar, não duplicar usuário");
});

test("findOrCreateOAuthUser sem e-mail cria usuário sem e-mail (não quebra)", async () => {
  const repo = new UserRepository(await createTestDb());
  const user = await repo.findOrCreateOAuthUser("discord", "discord-789", undefined);
  assert.equal(user.email, null);
});

// --- issue #70: nome/avatar do provedor OAuth --------------------------------

test("findOrCreateOAuthUser persiste displayName/avatarUrl do perfil na criação", async () => {
  const repo = new UserRepository(await createTestDb());
  const user = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", {
    displayName: "Fulano de Tal",
    avatarUrl: "https://lh3.googleusercontent.com/foto.jpg",
  });
  assert.equal(user.displayName, "Fulano de Tal");
  assert.equal(user.avatarUrl, "https://lh3.googleusercontent.com/foto.jpg");
});

test("login OAuth novo por cima do mesmo vínculo atualiza nome/avatar (provedor usado por último vence)", async () => {
  const repo = new UserRepository(await createTestDb());
  await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Nome Antigo", avatarUrl: "https://old.example/a.png" });
  const updated = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Nome Novo", avatarUrl: "https://new.example/b.png" });
  assert.equal(updated.displayName, "Nome Novo");
  assert.equal(updated.avatarUrl, "https://new.example/b.png");
});

test("perfil sem displayName/avatarUrl nesta chamada não apaga o valor já salvo", async () => {
  const repo = new UserRepository(await createTestDb());
  await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Nome Bom", avatarUrl: "https://ok.example/a.png" });
  const stillThere = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", {});
  assert.equal(stillThere.displayName, "Nome Bom", "resposta incompleta pontual não deve apagar um nome já salvo");
  assert.equal(stillThere.avatarUrl, "https://ok.example/a.png");
});

test("segundo provedor vinculado à mesma conta (mesmo e-mail) também atualiza nome/avatar", async () => {
  const repo = new UserRepository(await createTestDb());
  const viaGoogle = await repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Via Google" });
  const viaGithub = await repo.findOrCreateOAuthUser("github", "gh-456", "a@b.com", { displayName: "Via GitHub" });
  assert.equal(viaGithub.id, viaGoogle.id, "mesmo e-mail deve linkar na mesma conta");
  assert.equal(viaGithub.displayName, "Via GitHub", "o provedor usado por último vence");
});

test("createWithPassword/findByEmail/findById começam com displayName/avatarUrl null (conta só-senha)", async () => {
  const repo = new UserRepository(await createTestDb());
  const created = await repo.createWithPassword("a@b.com", "hash1");
  assert.equal(created.displayName, null);
  assert.equal(created.avatarUrl, null);
  assert.equal((await repo.findByEmail("a@b.com"))?.displayName, null);
  assert.equal((await repo.findById(created.id))?.avatarUrl, null);
});

test("contas OAuth diferentes com e-mails diferentes nunca se misturam", async () => {
  const repo = new UserRepository(await createTestDb());
  const userA = await repo.findOrCreateOAuthUser("google", "acc-a", "a@b.com");
  const userB = await repo.findOrCreateOAuthUser("google", "acc-b", "outro@b.com");
  assert.notEqual(userA.id, userB.id);
});

test("ciclo de refresh token: criar, encontrar ativo, revogar, não encontrar mais", async () => {
  const repo = new UserRepository(await createTestDb());
  const user = await repo.createWithPassword("a@b.com", "hash1");
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  await repo.createRefreshToken(user.id, "hash-do-token", expiresAt);
  const active = await repo.findActiveRefreshToken("hash-do-token");
  assert.equal(active?.userId, user.id);

  await repo.revokeRefreshToken(active!.id);
  assert.equal(await repo.findActiveRefreshToken("hash-do-token"), undefined);
});

test("refresh token expirado não é encontrado como ativo", async () => {
  const repo = new UserRepository(await createTestDb());
  const user = await repo.createWithPassword("a@b.com", "hash1");
  const alreadyExpired = new Date(Date.now() - 60_000).toISOString();

  await repo.createRefreshToken(user.id, "hash-vencido", alreadyExpired);
  assert.equal(await repo.findActiveRefreshToken("hash-vencido"), undefined);
});
