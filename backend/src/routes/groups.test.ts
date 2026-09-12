import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../server.js";
import { FakeTokenVerifier } from "../testing/fakeTokenVerifier.js";
import { createTestDb } from "../testing/testDb.js";

function build() {
  return buildServer({
    verifier: new FakeTokenVerifier(),
    db: createTestDb(),
    corsAllowedOrigins: ["http://127.0.0.1:5173"],
  });
}

function auth(uid: string) {
  return { authorization: `Bearer user:${uid}` };
}

test("criar grupo torna o criador owner; grupo aparece na listagem dele", async () => {
  const app = build();
  try {
    const create = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth("owner1"),
      payload: { name: "Equipe" },
    });
    assert.equal(create.statusCode, 201);
    const group = create.json();
    assert.equal(group.name, "Equipe");
    assert.equal(group.role, "owner");
    assert.equal(group.ownerId, "owner1");

    const list = await app.inject({ method: "GET", url: "/v1/groups", headers: auth("owner1") });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().groups.length, 1);

    const listOther = await app.inject({ method: "GET", url: "/v1/groups", headers: auth("outsider1") });
    assert.deepEqual(listOther.json().groups, []);
  } finally {
    await app.close();
  }
});

test("criar grupo sem nome falha com 422", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth("owner1"),
      payload: { name: "" },
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, "validation_error");
  } finally {
    await app.close();
  }
});

async function createGroup(app: ReturnType<typeof build>, ownerUid: string, name = "Equipe") {
  const response = await app.inject({ method: "POST", url: "/v1/groups", headers: auth(ownerUid), payload: { name } });
  return response.json() as { id: string };
}

test("quem não é membro recebe 404 ao ver o grupo (não 403 — não revela existência)", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const response = await app.inject({ method: "GET", url: `/v1/groups/${group.id}`, headers: auth("outsider1") });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("membro comum não pode renomear o grupo; owner pode", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const invite = (
      await app.inject({ method: "POST", url: `/v1/groups/${group.id}/invites`, headers: auth("owner1") })
    ).json();
    await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });

    const asMember = await app.inject({
      method: "PATCH",
      url: `/v1/groups/${group.id}`,
      headers: auth("member1"),
      payload: { name: "Novo nome" },
    });
    assert.equal(asMember.statusCode, 403);

    const asOwner = await app.inject({
      method: "PATCH",
      url: `/v1/groups/${group.id}`,
      headers: auth("owner1"),
      payload: { name: "Novo nome" },
    });
    assert.equal(asOwner.statusCode, 200);
    assert.equal(asOwner.json().name, "Novo nome");
  } finally {
    await app.close();
  }
});

test("owner não pode saír sem transferir/excluir (409); membro comum pode saír (204)", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const invite = (
      await app.inject({ method: "POST", url: `/v1/groups/${group.id}/invites`, headers: auth("owner1") })
    ).json();
    await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });

    const ownerLeave = await app.inject({ method: "POST", url: `/v1/groups/${group.id}/leave`, headers: auth("owner1") });
    assert.equal(ownerLeave.statusCode, 409);

    const memberLeave = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/leave`,
      headers: auth("member1"),
    });
    assert.equal(memberLeave.statusCode, 204);

    const afterLeave = await app.inject({ method: "GET", url: `/v1/groups/${group.id}`, headers: auth("member1") });
    assert.equal(afterLeave.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("só owner pode excluir o grupo; exclusão remove membros e convites", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const invite = (
      await app.inject({ method: "POST", url: `/v1/groups/${group.id}/invites`, headers: auth("owner1") })
    ).json();
    await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });

    const asMember = await app.inject({ method: "DELETE", url: `/v1/groups/${group.id}`, headers: auth("member1") });
    assert.equal(asMember.statusCode, 403);

    const asOwner = await app.inject({ method: "DELETE", url: `/v1/groups/${group.id}`, headers: auth("owner1") });
    assert.equal(asOwner.statusCode, 204);

    const afterDelete = await app.inject({ method: "GET", url: `/v1/groups/${group.id}`, headers: auth("owner1") });
    assert.equal(afterDelete.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("convite: criar exige owner/admin; membro comum recebe 403", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const asOwner = await app.inject({ method: "POST", url: `/v1/groups/${group.id}/invites`, headers: auth("owner1") });
    assert.equal(asOwner.statusCode, 201);
    assert.ok(asOwner.json().token);

    const invite = asOwner.json();
    await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });

    const asMember = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/invites`,
      headers: auth("member1"),
    });
    assert.equal(asMember.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("aceitar convite é idempotente para o mesmo usuário", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const invite = (
      await app.inject({
        method: "POST",
        url: `/v1/groups/${group.id}/invites`,
        headers: auth("owner1"),
        payload: { maxUses: 1 },
      })
    ).json();

    const first = await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().role, "member");

    const second = await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });
    assert.equal(second.statusCode, 200, "aceitar de novo não deve falhar mesmo com maxUses=1 já consumido por ele mesmo");
  } finally {
    await app.close();
  }
});

test("convite esgotado (maxUses) rejeita um segundo usuário diferente", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const invite = (
      await app.inject({
        method: "POST",
        url: `/v1/groups/${group.id}/invites`,
        headers: auth("owner1"),
        payload: { maxUses: 1 },
      })
    ).json();

    await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth("member1") });
    const secondUser = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.token}/accept`,
      headers: auth("member2"),
    });
    assert.equal(secondUser.statusCode, 409);
  } finally {
    await app.close();
  }
});

test("token de convite inexistente/inválido responde 409", async () => {
  const app = build();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/invites/token-que-nao-existe/accept",
      headers: auth("qualquer1"),
    });
    assert.equal(response.statusCode, 409);
  } finally {
    await app.close();
  }
});

test("convite revogado não aparece na listagem e não pode mais ser aceito", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const invite = (
      await app.inject({ method: "POST", url: `/v1/groups/${group.id}/invites`, headers: auth("owner1") })
    ).json();

    const beforeRevoke = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/invites`,
      headers: auth("owner1"),
    });
    assert.equal(beforeRevoke.json().invites.length, 1);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/v1/groups/${group.id}/invites/${invite.id}`,
      headers: auth("owner1"),
    });
    assert.equal(revoke.statusCode, 204);

    const afterRevoke = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/invites`,
      headers: auth("owner1"),
    });
    assert.deepEqual(afterRevoke.json().invites, []);

    const acceptAfterRevoke = await app.inject({
      method: "POST",
      url: `/v1/invites/${invite.token}/accept`,
      headers: auth("member1"),
    });
    assert.equal(acceptAfterRevoke.statusCode, 409);
  } finally {
    await app.close();
  }
});
