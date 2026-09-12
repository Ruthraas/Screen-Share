// Test-only identity responses. No account is created and no credentials are sent.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const uid = "ui-test-account";
let displayName = "";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "RS256" })}.${encode({ auth_time: Math.floor(Date.now() / 1000), sub: uid, user_id: uid, email: "ui-test@example.invalid", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: "password" } })}.test`;
await page.route("https://identitytoolkit.googleapis.com/**", async route => {
  const url = route.request().url();
  if (url.includes("accounts:update")) displayName = route.request().postDataJSON().displayName ?? displayName;
  const body = url.includes("accounts:lookup")
    ? { users: [{ localId: uid, email: "ui-test@example.invalid", displayName, providerUserInfo: [], createdAt: "0", lastLoginAt: "0" }] }
    : { localId: uid, email: "ui-test@example.invalid", displayName, idToken: token, refreshToken: "test-only-refresh", expiresIn: "3600", registered: true };
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
});
await page.route("https://securetoken.googleapis.com/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ access_token: token, refresh_token: "test-only-refresh", expires_in: "3600", user_id: uid }) }));

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
  await page.goto("http://127.0.0.1:5173/#/login");
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
  await page.goto("http://127.0.0.1:5173/#/profile");
  await page.getByRole("button", { name: "entrar", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: identity fixture, local groups/profile/preferences, logout, route gate, wave geometry and hover opacity.");
} catch (error) { await snapshot("failure"); console.log("page", await page.locator("body").innerText()); console.log("errors", errors); throw error; } finally { await browser.close(); }
