#!/usr/bin/env node
// Teste de capacidade da camada de sinalização (issue #47) — conexões
// simultâneas, relay sob carga, perda de conexão e reconexão, com
// relatório. Roda contra um backend REAL (mesma filosofia de
// testar-fluxo-completo.mjs): sobe conexões WebSocket de verdade, mede
// latência de handshake e de relay ponta a ponta, simula queda abrupta
// (perda de pacote/rede) e reconexão, e escreve um relatório com os
// números observados.
//
// IMPORTANTE — o que este teste NÃO cobre (ver docs/backend/TESTE_CAPACIDADE_SIGNALING.md):
// não existe cliente RTCPeerConnection ainda (issue #71, aberta), então
// não há SDP/mídia de verdade nem "bitrate" real pra medir — só o relay
// de sinalização (mensagens pequenas). TURN é um serviço gerenciado da
// Cloudflare (issue #40) — CPU/memória do relay de mídia não são
// infraestrutura nossa pra medir. Isto é um teste SINTÉTICO, na mesma
// máquina, sem condições de rede reais — nunca interpretar como garantia
// de produção (regra explícita da issue #47).
//
// Uso:
//   npm run dev   (em outro terminal — SUBIR com limites altos pra não
//                  confundir "capacidade real" com o rate limit anti-abuso,
//                  que é por IP e não faz sentido nesta simulação de um IP só):
//     RATE_LIMIT_REGISTER_MAX=100000 RATE_LIMIT_WS_CONNECT_MAX=100000 npm run dev
//   node scripts/teste-capacidade-signaling.mjs
//   CONNECTIONS=200 GROUPS=20 RUNS=2 node scripts/teste-capacidade-signaling.mjs

import { WebSocket } from "ws";
import { writeFileSync, mkdirSync } from "node:fs";
import { cpus, totalmem, platform, release } from "node:os";

function decodeUid(accessToken) {
  const [body] = accessToken.split(".");
  const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")).uid;
}

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const GROUPS = Number(process.env.GROUPS ?? 10);
const RUNS = Number(process.env.RUNS ?? 2);
const MEMBERS_PER_GROUP = Math.ceil(CONNECTIONS / GROUPS);
const DISCONNECT_FRACTION = 0.2; // simula ~20% das conexões caindo e reconectando.

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

async function request(method, path, body, token) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function registerUser(email) {
  const { status, json } = await request("POST", "/v1/auth/register", { email, password: "senha-forte-123" });
  if (status !== 201) throw new Error(`registro falhou (${status}): ${JSON.stringify(json)}`);
  return json.accessToken;
}

/**
 * Roda `items` por `fn` com no máximo `concurrency` chamadas em paralelo.
 * Registro (scrypt, deliberadamente caro de CPU) rodando um de cada vez
 * nunca usa a threadpool do libuv do lado do servidor (`hashPassword` é
 * assíncrono via `scryptAsync`, mas só se beneficia de fato se várias
 * chamadas estiverem em voo ao mesmo tempo) — sequencial faz um teste de
 * "capacidade de sinalização" na prática medir só a velocidade de setup
 * HTTP, não a sinalização em si.
 */
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function setupGroups(runId) {
  const setupStartedAt = performance.now();
  let registered = 0;
  const total = GROUPS * MEMBERS_PER_GROUP;
  function progress() {
    registered++;
    if (registered % 100 === 0 || registered === total) {
      console.log(`  setup: ${registered}/${total} usuários registrados (${Math.round(performance.now() - setupStartedAt)}ms)`);
    }
  }

  const groups = await mapPool(Array.from({ length: GROUPS }, (_, g) => g), 25, async (g) => {
    const ownerToken = await registerUser(`cap-${runId}-g${g}-owner+${Date.now()}${Math.random()}@teste.local`);
    progress();
    const created = await request("POST", "/v1/groups", { name: `Capacidade ${runId}-${g}` }, ownerToken);
    const groupId = created.json.id;
    const members = [{ token: ownerToken }];
    const remaining = MEMBERS_PER_GROUP - 1;
    if (remaining > 0) {
      const invite = await request("POST", `/v1/groups/${groupId}/invites`, { maxUses: remaining, expiresInMinutes: 30 }, ownerToken);
      const joined = await mapPool(Array.from({ length: remaining }, (_, m) => m), 25, async (m) => {
        const token = await registerUser(`cap-${runId}-g${g}-m${m}+${Date.now()}${Math.random()}@teste.local`);
        progress();
        await request("POST", `/v1/invites/${invite.json.token}/accept`, {}, token);
        return { token };
      });
      members.push(...joined);
    }
    return { groupId, members };
  });
  console.log(`  setup completo: ${total} usuários em ${Math.round(performance.now() - setupStartedAt)}ms`);
  return groups;
}

function connect(groupId, token) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}&groupId=${encodeURIComponent(groupId)}`);
    const timeout = setTimeout(() => reject(new Error("timeout conectando")), 10_000);
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      const event = JSON.parse(raw.toString());
      if (event.type !== "joined") {
        reject(new Error(`esperava 'joined', veio '${event.type}'`));
        return;
      }
      resolve({ socket, connectMs: performance.now() - startedAt });
    });
    socket.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function runScenario(runId) {
  const failures = [];
  const memBefore = process.memoryUsage().rss;

  const groups = await setupGroups(runId);

  const connectLatencies = [];
  const connections = []; // { socket, groupId, uid }
  const connectStartAll = performance.now();

  // "Conexões simultâneas" (critério da issue #47) — abre todas de uma
  // vez, não uma de cada vez; connectMs de cada uma já reflete a
  // contenção real de abrir centenas juntas.
  const connectJobs = groups.flatMap((group) => group.members.map((member) => ({ groupId: group.groupId, member })));
  await mapPool(connectJobs, connectJobs.length, async ({ groupId, member }) => {
    try {
      const { socket, connectMs } = await connect(groupId, member.token);
      connectLatencies.push(connectMs);
      connections.push({ socket, groupId, uid: decodeUid(member.token) });
    } catch (err) {
      failures.push(`connect: ${err.message}`);
    }
  });
  const totalConnectMs = performance.now() - connectStartAll;

  // Relay sob carga: dentro de cada grupo com 2+ membros, o primeiro manda
  // um "offer" pro segundo e mede o round-trip até a resposta chegar —
  // com todas as outras conexões já abertas e trocando handshake ao redor
  // (ruído realista de várias salas simultâneas).
  const relayLatencies = [];
  for (const group of groups) {
    const inGroup = connections.filter((c) => c.groupId === group.groupId);
    if (inGroup.length < 2) continue;
    const [a, b] = inGroup;
    const correlationId = crypto.randomUUID();
    const sentAt = performance.now();
    const received = new Promise((resolve) => {
      b.socket.once("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type === "offer") resolve(performance.now() - sentAt);
      });
    });
    a.socket.send(JSON.stringify({ v: 1, type: "offer", correlationId, to: b.uid, payload: { sdp: "v=0 (sintético, só pra medir o relay)" } }));
    try {
      const rtt = await Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]);
      relayLatencies.push(rtt);
    } catch {
      failures.push(`relay: timeout no grupo ${group.groupId}`);
    }
  }

  // Perda de conexão + reconexão: derruba uma fração das conexões sem
  // close limpo (.terminate(), não .close()) e mede quanto tempo até os
  // outros participantes do mesmo grupo serem avisados (peer-left) — isso
  // passa pelo heartbeat (#42) quando não há FIN de rede de verdade, mas
  // .terminate() aqui já simula a queda abrupta do lado do processo.
  const reconnectLatencies = [];
  const toDrop = connections.filter(() => Math.random() < DISCONNECT_FRACTION);
  for (const dropped of toDrop) {
    const peers = connections.filter((c) => c.groupId === dropped.groupId && c !== dropped);
    const droppedAt = performance.now();
    const notified = peers.length > 0
      ? Promise.race(
          peers.map(
            (peer) =>
              new Promise((resolve) => {
                peer.socket.once("message", function handler(raw) {
                  const event = JSON.parse(raw.toString());
                  if (event.type === "peer-left" && event.from === dropped.uid) resolve(performance.now() - droppedAt);
                  else peer.socket.once("message", handler);
                });
              }),
          ),
        )
      : Promise.resolve(0);
    dropped.socket.terminate();
    if (peers.length > 0) {
      try {
        reconnectLatencies.push(await Promise.race([notified, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]));
      } catch {
        failures.push(`peer-left não chegou a tempo pro grupo ${dropped.groupId}`);
      }
    }
  }

  for (const c of connections) {
    if (!toDrop.includes(c)) c.socket.terminate();
  }

  const memAfter = process.memoryUsage().rss;

  return {
    runId,
    requestedConnections: CONNECTIONS,
    successfulConnections: connectLatencies.length,
    failures,
    totalConnectMs: Math.round(totalConnectMs),
    connectLatencyMs: stats(connectLatencies),
    relayLatencyMs: stats(relayLatencies),
    reconnectNotifyLatencyMs: stats(reconnectLatencies),
    memoryRssDeltaMB: Math.round(((memAfter - memBefore) / 1024 / 1024) * 10) / 10,
  };
}

/**
 * Compara duas medições dentro de uma tolerância relativa OU um piso
 * absoluto (o que for mais generoso) — em números pequenos (poucos ms,
 * comum na camada de sinalização local), ruído normal do agendador do SO
 * já estoura qualquer tolerância relativa sem significar nada de errado;
 * só importa relativamente quando os valores já são grandes o bastante
 * pra diferença fazer sentido em termos de produto.
 */
function withinTolerance(a, b, toleranceFraction, absoluteFloorMs = 20) {
  if (a === 0 && b === 0) return true;
  if (Math.abs(a) <= absoluteFloorMs && Math.abs(b) <= absoluteFloorMs) return true;
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base <= toleranceFraction;
}

async function main() {
  const report = {
    geradoEm: new Date().toISOString(),
    ambiente: {
      apiUrl: API_URL,
      nodeVersion: process.version,
      plataforma: `${platform()} ${release()}`,
      cpus: cpus().length,
      memoriaTotalGB: Math.round((totalmem() / 1e9) * 10) / 10,
    },
    parametros: { CONNECTIONS, GROUPS, MEMBERS_PER_GROUP, RUNS, DISCONNECT_FRACTION },
    aviso: "Teste SINTÉTICO, mesma máquina, sem condições de rede reais — nunca interpretar como garantia de produção (issue #47). Não mede mídia/bitrate real: RTCPeerConnection do cliente (#71) ainda não existe.",
    execucoes: [],
  };

  for (let i = 0; i < RUNS; i++) {
    console.log(`\n=== Execução ${i + 1}/${RUNS} ===`);
    const result = await runScenario(`r${i}`);
    report.execucoes.push(result);
    console.log(`  Conexões: ${result.successfulConnections}/${result.requestedConnections} em ${result.totalConnectMs}ms`);
    console.log(`  Latência de connect (ms): p50=${result.connectLatencyMs.p50.toFixed(1)} p95=${result.connectLatencyMs.p95.toFixed(1)} max=${result.connectLatencyMs.max.toFixed(1)}`);
    console.log(`  Latência de relay (ms):   p50=${result.relayLatencyMs.p50.toFixed(1)} p95=${result.relayLatencyMs.p95.toFixed(1)} max=${result.relayLatencyMs.max.toFixed(1)}`);
    console.log(`  Latência de peer-left após queda (ms): p50=${result.reconnectNotifyLatencyMs.p50.toFixed(1)} max=${result.reconnectNotifyLatencyMs.max.toFixed(1)}`);
    console.log(`  Δ memória RSS do processo cliente: ${result.memoryRssDeltaMB}MB`);
    console.log(`  Falhas: ${result.failures.length}`);
    if (result.failures.length) console.log(`    ${result.failures.slice(0, 5).join("\n    ")}`);
  }

  if (report.execucoes.length >= 2) {
    const [first, second] = report.execucoes;
    const tolerance = 0.5; // 50% — máquina compartilhada, sem isolamento de rede/CPU; documentado de propósito.
    const absoluteFloorMs = 20; // abaixo disso, ruído do SO domina — comparação relativa não é significativa.
    report.repetibilidade = {
      toleranciaDocumentada: tolerance,
      pisoAbsolutoMs: absoluteFloorMs,
      conexoesDentroDaTolerancia: withinTolerance(first.successfulConnections, second.successfulConnections, 0.1),
      p95ConnectDentroDaTolerancia: withinTolerance(first.connectLatencyMs.p95, second.connectLatencyMs.p95, tolerance),
      p95RelayDentroDaTolerancia: withinTolerance(first.relayLatencyMs.p95, second.relayLatencyMs.p95, tolerance),
    };
    console.log(`\n=== Repetibilidade (tolerância ${tolerance * 100}%) ===`);
    console.log(report.repetibilidade);
  }

  mkdirSync("reports", { recursive: true });
  const path = `reports/capacidade-signaling-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`\nRelatório salvo em backend/${path}`);
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exitCode = 1;
});
