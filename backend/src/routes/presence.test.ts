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
    signalingPath: "/ws",
  });
}

function auth(uid: string) {
  return { authorization: `Bearer user:${uid}` };
}

async function createGroup(app: ReturnType<typeof build>, ownerUid: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/groups",
    headers: auth(ownerUid),
    payload: { name: "Equipe" },
  });
  return response.json() as { id: string };
}

test("heartbeat de membro aparece na lista de presença do grupo", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");

    const heartbeat = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/presence/heartbeat`,
      headers: auth("owner1"),
    });
    assert.equal(heartbeat.statusCode, 204);

    const list = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/presence`,
      headers: auth("owner1"),
    });
    assert.equal(list.statusCode, 200);
    const members = list.json().members as { userId: string }[];
    assert.equal(members.length, 1);
    assert.equal(members[0].userId, "owner1");
  } finally {
    await app.close();
  }
});

test("quem não é membro não consegue enviar heartbeat nem ver presença (404)", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");

    const heartbeat = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/presence/heartbeat`,
      headers: auth("outsider1"),
    });
    assert.equal(heartbeat.statusCode, 404);

    const list = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/presence`,
      headers: auth("outsider1"),
    });
    assert.equal(list.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("grupo sem nenhum heartbeat responde lista vazia, não erro", async () => {
  const app = build();
  try {
    const group = await createGroup(app, "owner1");
    const list = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.id}/presence`,
      headers: auth("owner1"),
    });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().members, []);
  } finally {
    await app.close();
  }
});
