#!/usr/bin/env node
// Smoke test manual de ponta a ponta contra um backend REAL rodando (não é
// teste automatizado do `npm test` — aquele já cobre cada rota isolada via
// `.inject()`; este aqui prova que auth + grupos + convites + presença +
// sinalização funcionam JUNTOS, de verdade, pela rede, exatamente como dois
// clientes reais fariam). Ver docs/backend/TESTE_MANUAL_SINALIZACAO.md.
//
// Uso:
//   npm run dev            (em outro terminal, deixa o backend rodando)
//   node scripts/testar-fluxo-completo.mjs
//   API_URL=http://192.168.0.10:8787 node scripts/testar-fluxo-completo.mjs   (testando entre duas máquinas na LAN)

import { WebSocket } from "ws";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";
const RUN_ID = Date.now();

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.log(`  ✘ ${label}${detail ? " — " + detail : ""}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function request(method, path, body, token) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
}

async function registerUser(label, email) {
  const { status, json } = await request("POST", "/v1/auth/register", { email, password: "senha-forte-123" });
  ok(`${label}: registro (${email})`, status === 201, `status ${status}: ${JSON.stringify(json)}`);
  return json; // { accessToken, refreshToken }
}

function decodeUid(accessToken) {
  const [body] = accessToken.split(".");
  const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")).uid;
}

function connectSignaling(label, accessToken, groupId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(accessToken)}&groupId=${encodeURIComponent(groupId)}`);
    const events = [];
    const waiters = [];

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(event)) {
          waiters[i].resolve(event);
          waiters.splice(i, 1);
        }
      }
    });
    socket.on("error", reject);
    socket.once("open", () => resolve({ socket, events, waitFor }));

    function waitFor(match, timeoutMs = 5000) {
      const already = events.find(match);
      if (already) return Promise.resolve(already);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`${label}: timeout esperando evento`)), timeoutMs);
        waiters.push({
          match,
          resolve: (event) => {
            clearTimeout(timer);
            res(event);
          },
        });
      });
    }
  });
}

async function main() {
  section("1. Registro de dois usuários reais");
  const alice = await registerUser("Alice", `alice+${RUN_ID}@teste.local`);
  const bob = await registerUser("Bob", `bob+${RUN_ID}@teste.local`);
  if (!alice?.accessToken || !bob?.accessToken) {
    console.log("\nParando aqui — sem os dois tokens não dá pra continuar.");
    process.exitCode = 1;
    return;
  }
  const aliceUid = decodeUid(alice.accessToken);
  const bobUid = decodeUid(bob.accessToken);

  section("2. Grupo e convite (Alice é dona)");
  const createGroup = await request("POST", "/v1/groups", { name: `Teste E2E ${RUN_ID}` }, alice.accessToken);
  ok("Alice cria o grupo", createGroup.status === 201, JSON.stringify(createGroup.json));
  const groupId = createGroup.json?.id;

  const createInvite = await request("POST", `/v1/groups/${groupId}/invites`, { maxUses: 1, expiresInMinutes: 60 }, alice.accessToken);
  ok("Alice cria o convite", createInvite.status === 201, JSON.stringify(createInvite.json));
  const inviteToken = createInvite.json?.token;

  const acceptInvite = await request("POST", `/v1/invites/${inviteToken}/accept`, {}, bob.accessToken);
  ok("Bob aceita o convite e vira membro", acceptInvite.status === 200, JSON.stringify(acceptInvite.json));

  section("3. Presença (heartbeat + consulta)");
  const heartbeat = await request("POST", `/v1/groups/${groupId}/presence/heartbeat`, undefined, alice.accessToken);
  ok("Alice envia heartbeat", heartbeat.status === 204, `status ${heartbeat.status}`);
  const presence = await request("GET", `/v1/groups/${groupId}/presence`, undefined, bob.accessToken);
  ok("Bob consulta presença e vê Alice", presence.status === 200 && (presence.json?.members ?? []).some((m) => m.userId === aliceUid), JSON.stringify(presence.json));

  section("4. Sinalização WebSocket (offer/answer/ice, ponto-a-ponto de verdade)");
  const aliceConn = await connectSignaling("Alice", alice.accessToken, groupId);
  await aliceConn.waitFor((e) => e.type === "joined");
  ok("Alice conecta no /ws e recebe 'joined'", true);

  const bobConn = await connectSignaling("Bob", bob.accessToken, groupId);
  await bobConn.waitFor((e) => e.type === "joined");
  ok("Bob conecta no /ws e recebe 'joined'", true);

  const peerJoined = await aliceConn.waitFor((e) => e.type === "peer-joined" && e.from === bobUid);
  ok("Alice é avisada que Bob entrou (peer-joined)", !!peerJoined);

  const correlationId = crypto.randomUUID();
  aliceConn.socket.send(JSON.stringify({ v: 1, type: "offer", correlationId, to: bobUid, payload: { sdp: "v=0 (sdp fake só pra testar o transporte)" } }));
  const offerAtBob = await bobConn.waitFor((e) => e.type === "offer" && e.from === aliceUid);
  ok("Bob recebe o offer de Alice, com 'from' definido pelo servidor", offerAtBob?.payload?.sdp?.includes("sdp fake"));

  bobConn.socket.send(JSON.stringify({ v: 1, type: "answer", correlationId, to: aliceUid, payload: { sdp: "v=0 (resposta fake)" } }));
  const answerAtAlice = await aliceConn.waitFor((e) => e.type === "answer" && e.from === bobUid);
  ok("Alice recebe a answer de Bob", !!answerAtAlice);

  aliceConn.socket.send(JSON.stringify({ v: 1, type: "ice-candidate", correlationId, to: bobUid, payload: { candidate: "candidate:1 1 UDP 1 127.0.0.1 1 typ host", sdpMid: "0", sdpMLineIndex: 0 } }));
  const iceAtBob = await bobConn.waitFor((e) => e.type === "ice-candidate" && e.from === aliceUid);
  ok("Bob recebe o ice-candidate de Alice", !!iceAtBob);

  aliceConn.socket.send(JSON.stringify({ v: 1, type: "stream-started", correlationId }));
  const streamStartedAtBob = await bobConn.waitFor((e) => e.type === "stream-started" && e.from === aliceUid);
  ok("Bob recebe stream-started de Alice (broadcast)", !!streamStartedAtBob);

  bobConn.socket.close();
  const peerLeftAtAlice = await aliceConn.waitFor((e) => e.type === "peer-left" && e.from === bobUid);
  ok("Alice é avisada que Bob saiu (peer-left)", !!peerLeftAtAlice);
  aliceConn.socket.close();

  section("Resultado");
  console.log(`${passed} passos ok, ${failed} falharam.`);
  console.log(
    failed === 0
      ? "\nO backend sozinho (auth + grupos + convites + presença + sinalização) funciona de ponta a ponta contra um servidor real."
      : "\nAlgo no backend não se comportou como esperado — ver detalhes acima antes de seguir pra teste manual no app.",
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("\nErro inesperado:", err);
  process.exitCode = 1;
});
