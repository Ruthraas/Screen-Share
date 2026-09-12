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
const uid = "ui-test-account";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
// Formato do access token do backend próprio (issue #30): base64url(json) + "." + base64url(hmac).
// A assinatura não é verificada no cliente, só decodificada — qualquer sufixo serve aqui.
const accessToken = `${encode({ uid, email: "ui-test@example.invalid", exp: Date.now() + 3_600_000 })}.test-signature`;
await page.route("**/v1/auth/login", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken, refreshToken: "test-only-refresh" }) }));
await page.route("**/v1/auth/refresh", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ accessToken, refreshToken: "test-only-refresh" }) }));
await page.route("**/v1/auth/logout", route => route.fulfill({ status: 204, body: "" }));

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
}
try {
  await page.goto(`${BASE_URL}/#/login`);
  await page.waitForTimeout(3200);
  await snapshot("login");
  await page.getByLabel("email:", { exact: true }).fill("ui-test@example.invalid");
  await page.getByLabel("senha:", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await page.getByRole("heading", { name: "nenhum grupo ainda" }).waitFor();
  await page.waitForTimeout(3200);
  await wave(); await snapshot("empty");
  await page.getByRole("button", { name: "criar meu primeiro grupo" }).click();
  await page.getByLabel("nome:", { exact: true }).fill("grupo de teste local");
  await page.getByRole("button", { name: "criar grupo", exact: true }).click();
  await page.getByText("compartilhar_tela", { exact: true }).waitFor();
  await wave(); await snapshot("home");
  await page.getByTitle("grupos", { exact: true }).click();
  await page.getByRole("heading", { name: "grupos", exact: true }).waitFor();
  await wave(); await snapshot("groups");
  await page.getByTitle("configuracoes", { exact: true }).click();
  await page.getByRole("button", { name: "claro", exact: true }).click();
  await wave(); await snapshot("settings-light");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wave-front").trim()), "#B9D2BE");
  await page.getByTitle("perfil", { exact: true }).click();
  await page.getByRole("menuitem", { name: "perfil", exact: true }).click();
  await page.getByLabel("nome:", { exact: true }).fill("nome salvo");
  await page.getByLabel("bio:", { exact: true }).fill("bio local de teste");
  await page.getByRole("button", { name: "salvar", exact: true }).click();
  await page.getByText("perfil salvo", { exact: true }).waitFor();
  await wave(); await snapshot("profile");
  await page.reload(); await page.waitForTimeout(3400);
  assert.equal(await page.getByLabel("bio:", { exact: true }).inputValue(), "bio local de teste");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(16 + (i % 3) * 12, 25 + (i % 5) * 20);
    assert.equal(await page.locator(".app-window").evaluate(element => getComputedStyle(element).opacity), "1");
  }
  await page.mouse.move(0, 0); await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "comandos" }).waitFor();
  await wave(); await snapshot("palette"); await page.keyboard.press("Escape");
  for (const viewport of [{ width: 800, height: 460 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) { await page.setViewportSize(viewport); await wave(); }
  await page.getByTitle("configuracoes", { exact: true }).click();
  await page.getByRole("button", { name: "sair da conta", exact: true }).click();
  await page.getByRole("button", { name: "entrar", exact: true }).waitFor();
  await page.goto(`${BASE_URL}/#/profile`);
  await page.getByRole("button", { name: "entrar", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: identity fixture, local groups/profile/preferences, logout, route gate, wave geometry and hover opacity.");
} catch (error) { await snapshot("failure"); console.log("page", await page.locator("body").innerText()); console.log("errors", errors); throw error; } finally { await browser.close(); killDevServerTree(devServer); }
