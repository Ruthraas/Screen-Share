import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { buildServer, type BuildServerOptions } from "../server.js";
import { FakeTokenVerifier } from "../testing/fakeTokenVerifier.js";
import { createTestDb } from "../testing/testDb.js";
import { testAuthConfig } from "../testing/testAuthConfig.js";
import type { FastifyInstance } from "fastify";

/**
 * Sobe um servidor real em porta efêmera (127.0.0.1:0) em vez de usar
 * app.inject()/injectWS(): o transporte injetado do @fastify/websocket tem
 * uma peculiaridade só de teste em que uma mensagem enviada no mesmo tick
 * da conexão nunca chega ao cliente (confirmado isoladamente — não
 * reproduz com um socket TCP real). Sinalização manda "joined" assim que
 * conecta, então precisamos do socket de verdade aqui.
 */
async function build(logger?: BuildServerOptions["logger"]): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = buildServer({
    verifier: new FakeTokenVerifier(),
    db: createTestDb(),
    authConfig: testAuthConfig(),
    corsAllowedOrigins: ["http://127.0.0.1:5173"],
    signalingPath: "/ws",
    ...(logger ? { logger } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("endereço do servidor de teste inesperado");
  return { app, baseUrl: `ws://127.0.0.1:${address.port}` };
}

function auth(uid: string) {
  return { authorization: `Bearer user:${uid}` };
}

async function createGroupWithMember(app: FastifyInstance, ownerUid: string, memberUid: string) {
  const group = (
    await app.inject({ method: "POST", url: "/v1/groups", headers: auth(ownerUid), payload: { name: "Equipe" } })
  ).json() as { id: string };
  const invite = (
    await app.inject({ method: "POST", url: `/v1/groups/${group.id}/invites`, headers: auth(ownerUid) })
  ).json() as { token: string };
  await app.inject({ method: "POST", url: `/v1/invites/${invite.token}/accept`, headers: auth(memberUid) });
  return group;
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
  });
}

function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code: number) => resolve(code));
  });
}

test("conexão válida recebe 'joined' com a lista de membros já conectados", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const ws = new WebSocket(`${baseUrl}/ws?token=user:owner1&groupId=${group.id}`);
    try {
      const joined = await nextMessage(ws);
      assert.equal(joined.type, "joined");
      assert.equal(joined.v, 1);
      assert.deepEqual(joined.payload.members, ["owner1"]);
    } finally {
      ws.terminate();
    }
  } finally {
    await app.close();
  }
});

test("token inválido fecha a conexão com código 4401", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const ws = new WebSocket(`${baseUrl}/ws?token=lixo-invalido&groupId=${group.id}`);
    const closeCode = await nextClose(ws);
    assert.equal(closeCode, 4401);
  } finally {
    await app.close();
  }
});

test("token válido mas fora do grupo fecha a conexão com código 4403", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const ws = new WebSocket(`${baseUrl}/ws?token=user:outsider1&groupId=${group.id}`);
    const closeCode = await nextClose(ws);
    assert.equal(closeCode, 4403);
  } finally {
    await app.close();
  }
});

test("offer chega ao destinatário com 'from' definido pelo servidor, nunca pelo cliente", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const wsOwner = new WebSocket(`${baseUrl}/ws?token=user:owner1&groupId=${group.id}`);
    await nextMessage(wsOwner); // "joined"
    const wsMember = new WebSocket(`${baseUrl}/ws?token=user:member1&groupId=${group.id}`);
    await nextMessage(wsMember); // "joined"
    await nextMessage(wsOwner); // "peer-joined" do member1

    const nextOnOwner = nextMessage(wsOwner);
    wsMember.send(
      JSON.stringify({
        v: 1,
        type: "offer",
        correlationId: "corr-1",
        to: "owner1",
        payload: { sdp: "v=0..." },
        from: "algum-uid-forjado",
      }),
    );

    const received = await nextOnOwner;
    assert.equal(received.type, "offer");
    assert.equal(received.from, "member1", "from vem da conexão autenticada, não do payload do cliente");
    assert.equal(received.correlationId, "corr-1");
    assert.equal(received.payload.sdp, "v=0...");

    wsOwner.terminate();
    wsMember.terminate();
  } finally {
    await app.close();
  }
});

test("evento sem 'to' (stream-started) é broadcast pros outros, não pro próprio remetente", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const wsOwner = new WebSocket(`${baseUrl}/ws?token=user:owner1&groupId=${group.id}`);
    await nextMessage(wsOwner);
    const wsMember = new WebSocket(`${baseUrl}/ws?token=user:member1&groupId=${group.id}`);
    await nextMessage(wsMember);
    await nextMessage(wsOwner); // peer-joined

    const nextOnMember = nextMessage(wsMember);
    wsOwner.send(JSON.stringify({ v: 1, type: "stream-started", correlationId: "corr-2" }));
    const received = await nextOnMember;
    assert.equal(received.type, "stream-started");
    assert.equal(received.from, "owner1");

    wsOwner.terminate();
    wsMember.terminate();
  } finally {
    await app.close();
  }
});

test("mensagem com schema inválido recebe evento de erro e a conexão continua aberta", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const ws = new WebSocket(`${baseUrl}/ws?token=user:owner1&groupId=${group.id}`);
    await nextMessage(ws); // joined

    const next = nextMessage(ws);
    ws.send(JSON.stringify({ v: 1, type: "offer", correlationId: "c1" })); // falta 'to' e 'payload.sdp'
    const errorMsg = await next;
    assert.equal(errorMsg.type, "error");
    assert.equal(errorMsg.payload.code, "invalid_message");

    ws.terminate();
  } finally {
    await app.close();
  }
});

test("ao desconectar, os demais participantes recebem 'peer-left'", async () => {
  const { app, baseUrl } = await build();
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const wsOwner = new WebSocket(`${baseUrl}/ws?token=user:owner1&groupId=${group.id}`);
    await nextMessage(wsOwner);
    const wsMember = new WebSocket(`${baseUrl}/ws?token=user:member1&groupId=${group.id}`);
    await nextMessage(wsMember);
    await nextMessage(wsOwner); // peer-joined

    const nextOnOwner = nextMessage(wsOwner);
    wsMember.terminate();
    const left = await nextOnOwner;
    assert.equal(left.type, "peer-left");
    assert.equal(left.from, "member1");

    wsOwner.terminate();
  } finally {
    await app.close();
  }
});

test("SDP/ICE nunca aparecem em texto puro no log", async () => {
  const logLines: string[] = [];
  const { app, baseUrl } = await build({
    level: "info",
    stream: {
      write: (line: string) => {
        logLines.push(line);
        return true;
      },
    },
  });
  try {
    const group = await createGroupWithMember(app, "owner1", "member1");
    const wsOwner = new WebSocket(`${baseUrl}/ws?token=user:owner1&groupId=${group.id}`);
    await nextMessage(wsOwner);
    const wsMember = new WebSocket(`${baseUrl}/ws?token=user:member1&groupId=${group.id}`);
    await nextMessage(wsMember);
    await nextMessage(wsOwner);

    const nextOnOwner = nextMessage(wsOwner);
    const secretSdp = "v=0-super-secret-sdp-marker";
    wsMember.send(JSON.stringify({ v: 1, type: "offer", correlationId: "c1", to: "owner1", payload: { sdp: secretSdp } }));
    await nextOnOwner;

    const fullLog = logLines.join("\n");
    assert.doesNotMatch(fullLog, new RegExp(secretSdp), "SDP não pode aparecer em texto puro no log");

    wsOwner.terminate();
    wsMember.terminate();
  } finally {
    await app.close();
  }
});
