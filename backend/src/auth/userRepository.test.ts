import { test } from "node:test";
import assert from "node:assert/strict";
import { UserRepository } from "./userRepository.js";
import { createTestDb } from "../testing/testDb.js";
import { ConflictError } from "../errors.js";

test("createWithPassword cria usuário e rejeita e-mail duplicado", () => {
  const repo = new UserRepository(createTestDb());
  const user = repo.createWithPassword("a@b.com", "hash1");
  assert.equal(user.email, "a@b.com");

  assert.throws(() => repo.createWithPassword("a@b.com", "hash2"), ConflictError);
});

test("findByEmail devolve o password_hash pra verificação", () => {
  const repo = new UserRepository(createTestDb());
  repo.createWithPassword("a@b.com", "hash-armazenado");
  const found = repo.findByEmail("a@b.com");
  assert.equal(found?.passwordHash, "hash-armazenado");
});

test("findOrCreateOAuthUser cria usuário novo na primeira vez", () => {
  const repo = new UserRepository(createTestDb());
  const user = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com");
  assert.equal(user.email, "a@b.com");
});

test("findOrCreateOAuthUser é idempotente pro mesmo provider+conta", () => {
  const repo = new UserRepository(createTestDb());
  const first = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com");
  const second = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com");
  assert.equal(first.id, second.id);
});

test("findOrCreateOAuthUser vincula a uma conta de senha existente com o mesmo e-mail", () => {
  const repo = new UserRepository(createTestDb());
  const passwordUser = repo.createWithPassword("a@b.com", "hash1");
  const oauthUser = repo.findOrCreateOAuthUser("github", "gh-456", "a@b.com");
  assert.equal(oauthUser.id, passwordUser.id, "deve linkar, não duplicar usuário");
});

test("findOrCreateOAuthUser sem e-mail cria usuário sem e-mail (não quebra)", () => {
  const repo = new UserRepository(createTestDb());
  const user = repo.findOrCreateOAuthUser("discord", "discord-789", undefined);
  assert.equal(user.email, null);
});

// --- issue #70: nome/avatar do provedor OAuth --------------------------------

test("findOrCreateOAuthUser persiste displayName/avatarUrl do perfil na criação", () => {
  const repo = new UserRepository(createTestDb());
  const user = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", {
    displayName: "Fulano de Tal",
    avatarUrl: "https://lh3.googleusercontent.com/foto.jpg",
  });
  assert.equal(user.displayName, "Fulano de Tal");
  assert.equal(user.avatarUrl, "https://lh3.googleusercontent.com/foto.jpg");
});

test("login OAuth novo por cima do mesmo vínculo atualiza nome/avatar (provedor usado por último vence)", () => {
  const repo = new UserRepository(createTestDb());
  repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Nome Antigo", avatarUrl: "https://old.example/a.png" });
  const updated = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Nome Novo", avatarUrl: "https://new.example/b.png" });
  assert.equal(updated.displayName, "Nome Novo");
  assert.equal(updated.avatarUrl, "https://new.example/b.png");
});

test("perfil sem displayName/avatarUrl nesta chamada não apaga o valor já salvo", () => {
  const repo = new UserRepository(createTestDb());
  repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Nome Bom", avatarUrl: "https://ok.example/a.png" });
  const stillThere = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", {});
  assert.equal(stillThere.displayName, "Nome Bom", "resposta incompleta pontual não deve apagar um nome já salvo");
  assert.equal(stillThere.avatarUrl, "https://ok.example/a.png");
});

test("segundo provedor vinculado à mesma conta (mesmo e-mail) também atualiza nome/avatar", () => {
  const repo = new UserRepository(createTestDb());
  const viaGoogle = repo.findOrCreateOAuthUser("google", "google-123", "a@b.com", { displayName: "Via Google" });
  const viaGithub = repo.findOrCreateOAuthUser("github", "gh-456", "a@b.com", { displayName: "Via GitHub" });
  assert.equal(viaGithub.id, viaGoogle.id, "mesmo e-mail deve linkar na mesma conta");
  assert.equal(viaGithub.displayName, "Via GitHub", "o provedor usado por último vence");
});

test("createWithPassword/findByEmail/findById começam com displayName/avatarUrl null (conta só-senha)", () => {
  const repo = new UserRepository(createTestDb());
  const created = repo.createWithPassword("a@b.com", "hash1");
  assert.equal(created.displayName, null);
  assert.equal(created.avatarUrl, null);
  assert.equal(repo.findByEmail("a@b.com")?.displayName, null);
  assert.equal(repo.findById(created.id)?.avatarUrl, null);
});

test("contas OAuth diferentes com e-mails diferentes nunca se misturam", () => {
  const repo = new UserRepository(createTestDb());
  const userA = repo.findOrCreateOAuthUser("google", "acc-a", "a@b.com");
  const userB = repo.findOrCreateOAuthUser("google", "acc-b", "outro@b.com");
  assert.notEqual(userA.id, userB.id);
});

test("ciclo de refresh token: criar, encontrar ativo, revogar, não encontrar mais", () => {
  const repo = new UserRepository(createTestDb());
  const user = repo.createWithPassword("a@b.com", "hash1");
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  repo.createRefreshToken(user.id, "hash-do-token", expiresAt);
  const active = repo.findActiveRefreshToken("hash-do-token");
  assert.equal(active?.userId, user.id);

  repo.revokeRefreshToken(active!.id);
  assert.equal(repo.findActiveRefreshToken("hash-do-token"), undefined);
});

test("refresh token expirado não é encontrado como ativo", () => {
  const repo = new UserRepository(createTestDb());
  const user = repo.createWithPassword("a@b.com", "hash1");
  const alreadyExpired = new Date(Date.now() - 60_000).toISOString();

  repo.createRefreshToken(user.id, "hash-vencido", alreadyExpired);
  assert.equal(repo.findActiveRefreshToken("hash-vencido"), undefined);
});
