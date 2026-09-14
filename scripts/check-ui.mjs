// Test-only identity responses. No account is created and no credentials are sent
// to a real backend — /v1/auth/* is intercepted below (issue #5 smoke test).
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 5180;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const API_URL = "http://smoke-test.invalid"; // nunca deve receber tráfego de verdade — tudo é interceptado.

async function devServerIsUp() {
  try {
    const response = await fetch(BASE_URL);
    return response.ok;
  } catch {
    return false;
  }
}

/** No Windows, `child.kill()` não mata a árvore inteira quando o processo
 * foi criado com `shell: true` (o `vite` real fica órfão, ainda escutando
 * a porta) — precisa `taskkill /t` pra matar o processo e os filhos dele. */
function killDevServerTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }); } catch { /* já pode ter morrido sozinho */ }
  } else {
    child.kill();
  }
}

let devServer;
if (!(await devServerIsUp())) {
  devServer = spawn(`npm run dev -- --port ${PORT}`, {
    env: { ...process.env, VITE_API_URL: API_URL },
    stdio: "ignore",
    shell: true,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await devServerIsUp()) { ready = true; break; }
    await delay(500);
  }
  if (!ready) throw new Error(`dev server nao respondeu em ${BASE_URL} a tempo`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
// issue #23: captura tudo que a camada de log (src/services/logger.ts)
// manda pro console real do navegador, pra validação obrigatória da issue
// ("testar casos de erro e pesquisar os logs por tokens/e-mails de teste")
// rodar contra o app de verdade, não só contra o `logger.ts` isolado.
const consoleLines = [];
page.on("console", msg => consoleLines.push(msg.text()));
const uid = "ui-test-account";
const testEmail = "ui-test@example.invalid";
const wrongPassword = "wrong-password-for-log-test";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
// Formato do access token do backend próprio (issue #30): base64url(json) + "." + base64url(hmac).
// A assinatura não é verificada no cliente, só decodificada — qualquer sufixo serve aqui.
// displayName/avatarUrl (issue #70, backend): só existem pra quem já logou
// via OAuth alguma vez — nulos aqui seriam o caso comum (conta só-senha),
// mas incluídos de propósito nesta fixture pra validar a prioridade real
// (nome do provedor OAuth até o usuário salvar um nome local por cima).
const oauthDisplayName = "Nome Do Provedor OAuth";
const accessToken = `${encode({ uid, email: testEmail, displayName: oauthDisplayName, avatarUrl: "https://example.invalid/avatar.png", exp: Date.now() + 3_600_000 })}.test-signature`;
const refreshTokenValue = "test-only-refresh";
await page.route("**/v1/auth/login", route => {
  const body = JSON.parse(route.request().postData() || "{}");
  if (body.password === wrongPassword) {
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "unauthorized", message: "E-mail ou senha invalidos." } }) });
  }
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken, refreshToken: refreshTokenValue }) });
});
await page.route("**/v1/auth/refresh", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken, refreshToken: refreshTokenValue }) }));
await page.route("**/v1/auth/logout", route => route.fulfill({ status: 204, body: "" }));

// issue #60: grupos/convites agora vêm da API de verdade — fixture mínima
// em memória (lista + criação + detalhe) só pra exercitar o fluxo real da
// UI (empty -> criar -> home -> pagina de grupos), sem precisar do backend.
const mockGroups = [];
await page.route("**/v1/groups", route => {
  const method = route.request().method();
  if (method === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ groups: mockGroups }) });
  if (method === "POST") {
    const body = JSON.parse(route.request().postData() || "{}");
    const group = { id: "grp_test", name: body.name, ownerId: uid, role: "owner", createdAt: new Date().toISOString() };
    mockGroups.push(group);
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(group) });
  }
  return route.continue();
});
await page.route("**/v1/groups/*", route => {
  if (route.request().method() !== "GET") return route.continue();
  const id = route.request().url().split("/").pop();
  const group = mockGroups.find(g => g.id === id);
  if (!group) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "grupo nao encontrado" } }) });
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...group, members: [{ userId: uid, role: "owner" }] }) });
});
// Presença real (nunca consumida pelo cliente antes desta rodada de
// melhorias de UI) — fixture simples: o próprio usuário sempre aparece
// online. Valida que a contagem some do "..." de carregamento pra um
// número de verdade, não só que a chamada não quebra a tela.
await page.route("**/v1/groups/*/presence", route => route.fulfill({
  contentType: "application/json",
  body: JSON.stringify({ members: [{ userId: uid, online: true, lastSeenAt: new Date().toISOString() }] }),
}));
await page.route("**/v1/groups/*/presence/heartbeat", route => route.fulfill({ status: 204, body: "" }));

// issue #71: assim que um grupo é selecionado, `RtcProvider` abre sinalização
// de verdade (`/ws`) e busca credenciais TURN. Sem backend real aqui, nunca
// deixa isso virar uma tentativa de rede de verdade: uma conexão WS que
// falha loga a URL completa (com o access token na query string — o
// WebSocket do navegador não aceita header `Authorization`, então o token
// vai ali por definição do protocolo) no console nativo do Chromium, o que
// SEMPRE vazaria o token no transcript varrido mais abaixo. Interceptar
// aqui em vez de deixar falhar é o jeito certo de nunca gerar esse log,
// não só de "passar no teste".
await page.routeWebSocket(/\/ws\?/, ws => ws.close());
await page.route("**/v1/turn-credentials", route => route.fulfill({
  status: 201,
  contentType: "application/json",
  body: JSON.stringify({ iceServers: [{ urls: ["stun:stun.example.invalid:3478"] }], ttlSeconds: 3600 }),
}));

await mkdir("artifacts/ui", { recursive: true });
async function snapshot(name) {
  await page.screenshot({ path: `artifacts/ui/${name}.png`, animations: "disabled" });
}
async function wave() {
  const metrics = await page.locator(".pixel-wave").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width, bottom: rect.bottom, windowWidth: innerWidth, windowHeight: innerHeight, pointerEvents: getComputedStyle(element).pointerEvents, patterns: element.querySelectorAll("pattern").length };
  });
  assert.equal(metrics.height, 28); assert.equal(metrics.width, metrics.windowWidth); assert.equal(metrics.bottom, metrics.windowHeight); assert.equal(metrics.patterns, 3); assert.equal(metrics.pointerEvents, "none");
  // issue #21: nenhuma rota visitada por este script deve ter overflow na janela.
  const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: innerWidth, scrollH: document.documentElement.scrollHeight, innerH: innerHeight }));
  assert.ok(overflow.scrollW <= overflow.innerW, `overflow horizontal: scrollWidth ${overflow.scrollW} > innerWidth ${overflow.innerW}`);
  assert.ok(overflow.scrollH <= overflow.innerH, `overflow vertical: scrollHeight ${overflow.scrollH} > innerHeight ${overflow.innerH}`);
}
try {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForTimeout(3200);
  await snapshot("login");

  // issue #23, validacao obrigatoria: "testar casos de erro e pesquisar os
  // logs por tokens/e-mails de teste" — dispara um login com senha errada
  // de proposito (o mock acima responde 401 de verdade pra essa senha) e
  // confere que o log de erro tem contexto util (codigo) sem vazar a senha
  // nem o e-mail usados.
  await page.getByLabel("email:", { exact: true }).fill(testEmail);
  await page.getByLabel("senha:", { exact: true }).fill(wrongPassword);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.getByRole("alert").waitFor();
  const authFailureLog = consoleLines.find(line => line.includes("[auth]") && line.includes("login falhou"));
  assert.ok(authFailureLog, "esperava um log [auth] de 'login falhou' apos a tentativa com senha errada");
  assert.ok(authFailureLog.includes("unauthorized"), `log de erro devia conter o codigo de erro pra ser util: ${authFailureLog}`);
  assert.ok(!authFailureLog.includes(wrongPassword), "log de erro nao deve conter a senha de teste");
  assert.ok(!authFailureLog.includes(testEmail), "log de erro nao deve conter o e-mail de teste");

  await page.getByLabel("senha:", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.getByRole("heading", { name: "nenhum grupo ainda" }).waitFor();
  await page.waitForTimeout(3200);
  await wave(); await snapshot("empty");
  await page.getByRole("button", { name: "criar meu primeiro grupo" }).click();
  await page.getByLabel("nome:", { exact: true }).fill("grupo de teste local");
  await page.getByRole("button", { name: "criar grupo", exact: true }).click();
  // Criar um grupo entra direto na sala dele (rota "room", separada da
  // lista) — não mais na tela de "compartilhar_tela".
  await page.getByRole("button", { name: "todos os grupos", exact: true }).waitFor();
  await wave(); await snapshot("room");
  await page.getByTitle("inicio", { exact: true }).click();
  await page.getByText("compartilhar_tela", { exact: true }).waitFor();
  await wave(); await snapshot("home");
  await page.getByTitle("grupos", { exact: true }).click();
  await page.getByRole("heading", { name: "grupos", exact: true }).waitFor();
  await page.getByText("1 online", { exact: true }).waitFor();
  await wave(); await snapshot("groups");
  // Clicar no card do grupo na lista deve entrar na sala de novo.
  await page.getByText("grupo de teste local", { exact: true }).click();
  await page.getByRole("button", { name: "todos os grupos", exact: true }).waitFor();
  await page.getByRole("button", { name: "todos os grupos", exact: true }).click();
  await page.getByRole("heading", { name: "grupos", exact: true }).waitFor();
  await page.getByTitle("configuracoes", { exact: true }).click();
  await page.getByRole("button", { name: "claro", exact: true }).click();
  await wave(); await snapshot("settings-light");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wave-front").trim()), "#B9D2BE");
  await page.getByTitle("perfil", { exact: true }).click();
  await page.getByRole("menuitem", { name: "perfil", exact: true }).click();
  // issue #70: nome do provedor OAuth é o padrão até o usuário salvar um
  // nome local por cima (prioridade real, não só "não quebrou").
  assert.equal(await page.getByLabel("nome:", { exact: true }).inputValue(), oauthDisplayName, "nome do provedor OAuth deveria ser o padrao antes de qualquer nome local salvo");
  await page.getByLabel("nome:", { exact: true }).fill("nome salvo");
  await page.getByLabel("bio:", { exact: true }).fill("bio local de teste");
  await page.getByRole("button", { name: "salvar", exact: true }).click();
  await page.getByText("perfil salvo", { exact: true }).waitFor();
  await wave(); await snapshot("profile");
  await page.reload(); await page.waitForTimeout(3400);
  assert.equal(await page.getByLabel("bio:", { exact: true }).inputValue(), "bio local de teste");
  assert.equal(await page.getByLabel("nome:", { exact: true }).inputValue(), "nome salvo", "nome local salvo deveria continuar vencendo o do provedor OAuth apos reload");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(16 + (i % 3) * 12, 25 + (i % 5) * 20);
    assert.equal(await page.locator(".app-window").evaluate(element => getComputedStyle(element).opacity), "1");
  }
  await page.mouse.move(0, 0); await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "comandos" }).waitFor();
  await wave(); await snapshot("palette");
  // As badges de atalho (g/n/,) só disparam com a busca vazia — dispara
  // "n" (criar grupo) antes de digitar qualquer coisa.
  await page.keyboard.press("n");
  await page.getByRole("heading", { name: "novo grupo" }).waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0); await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "comandos" }).waitFor();
  // issue #26/#17: a busca de verdade filtra a lista, e o item selecionado
  // acompanha o filtro — Enter no resultado filtrado navega certo.
  await page.keyboard.type("config");
  assert.deepEqual(await page.locator(".command-row span").allTextContents(), ["configuracoes"]);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "configuracoes" }).waitFor();
  // issue #21: as 3 resolucoes desktop suportadas, mais o tamanho minimo da janela (tauri.conf.json).
  for (const viewport of [{ width: 800, height: 460 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) { await page.setViewportSize(viewport); await wave(); }
  await page.getByRole("button", { name: "sair da conta", exact: true }).click();
  await page.getByRole("button", { name: "entrar", exact: true }).waitFor();
  await page.goto(`${BASE_URL}/#/profile`);
  await page.getByRole("button", { name: "entrar", exact: true }).waitFor();

  // issue #26/#19: ScreenViewer com MediaStream real, num harness isolado
  // (test-harness/, nunca faz parte do bundle de produção — não está em
  // vite.config.ts) servido pelo mesmo dev server.
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`${BASE_URL}/test-harness/screen-viewer.html`);
  await page.waitForFunction(() => !!window.__harness);
  assert.ok(await page.locator(".stream-placeholder").isVisible(), "sem stream, mostra placeholder");
  assert.equal(await page.locator(".stream-stage video").count(), 0, "sem stream, nao monta <video>");

  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 10; canvas.height = 10;
    window.__streamA = canvas.captureStream(0);
    window.__harness.setStream(window.__streamA);
  });
  await page.waitForSelector(".stream-stage video");
  assert.ok(await page.evaluate(() => document.querySelector(".stream-stage video").srcObject === window.__streamA), "video.srcObject === streamA");

  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 10; canvas.height = 10;
    window.__streamB = canvas.captureStream(0);
    window.__harness.setStream(window.__streamB);
  });
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => {
    const video = document.querySelector(".stream-stage video");
    return video.srcObject === window.__streamB && video.srcObject !== window.__streamA;
  }), "trocar de stream atualiza srcObject e larga o anterior");

  await page.evaluate(() => window.__harness.setStream(undefined));
  await page.waitForSelector(".stream-placeholder");
  assert.equal(await page.locator(".stream-stage video").count(), 0, "remover o stream volta ao placeholder e desmonta o <video>");

  await page.evaluate(() => window.__harness.setStream(window.__streamB));
  await page.waitForSelector(".stream-stage video");
  const endedBefore = await page.evaluate(() => window.__harness.endedCount());
  await page.evaluate(() => window.__streamB.dispatchEvent(new Event("inactive")));
  await page.waitForTimeout(150);
  const endedAfter = await page.evaluate(() => window.__harness.endedCount());
  assert.equal(endedAfter, endedBefore + 1, "onStreamEnded dispara quando o stream termina sozinho");
  // issue #23: a mesma trilha de log cobre "falhas de captura" — confirma
  // que o evento nativo 'inactive' (fim inesperado do stream) tambem gera
  // um log [capture], nao so o de auth testado acima.
  assert.ok(consoleLines.some(line => line.includes("[capture]") && line.includes("stream encerrado")), "esperava um log [capture] quando o stream termina sozinho");

  // issue #23, validacao obrigatoria: varredura final no transcript inteiro
  // do console (nao so no log de erro isolado acima) atras de qualquer
  // segredo/dado pessoal de teste que tenha vazado em QUALQUER log emitido
  // durante todo o fluxo (login, oauth, grupos, captura).
  const fullTranscript = consoleLines.join("\n");
  for (const secret of [wrongPassword, "test-only-password", testEmail, accessToken, refreshTokenValue]) {
    assert.ok(!fullTranscript.includes(secret), `segredo/dado de teste vazou nos logs: ${JSON.stringify(secret)}`);
  }

  assert.deepEqual(errors, []);
  console.log("PASS: identity fixture, local groups/profile/preferences, logout, route gate, command palette filter, ScreenViewer lifecycle, wave geometry and hover opacity, auth error logging without leaking secrets.");
} catch (error) { await snapshot("failure"); console.log("page", await page.locator("body").innerText()); console.log("errors", errors); throw error; } finally { await browser.close(); killDevServerTree(devServer); }
