import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * O backend (issue #30) nunca devolve um objeto de usuário — só o par de
 * tokens. `id`/`email` vêm de decodificar o próprio access token (payload
 * assinado, formato `base64url(json).base64url(hmac)`, ver
 * `backend/src/auth/signedPayload.ts`); não existe nome nem foto no
 * contrato, então o perfil exibido é sempre local (`localData.ts`).
 */
export type SessionUser = { id: string; email?: string };

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthSession = { user: SessionUser; tokens: AuthTokens };

export type OAuthProvider = "google" | "github" | "discord";
const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "github", "discord"];

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export class AuthError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

const REFRESH_TOKEN_KEY = "screenshare.refresh_token";
const OAUTH_ERROR_KEY = "screenshare.oauth_error";

type SessionListener = (user: SessionUser | null) => void;
let currentSession: AuthSession | null = null;
let currentError: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<SessionListener>();

/** Decodifica o payload do access token (sem verificar assinatura — só
 * pra ler `uid`/`email`/`exp` pro lado do cliente; a verificação de
 * verdade é sempre do backend). Formato: `base64url(json).base64url(hmac)`,
 * não é JWT (não tem header, e o `exp` já vem em milissegundos, não em
 * segundos). */
function decodeAccessTokenPayload(token: string): { uid: string; email?: string; exp: number } | null {
  const [body] = token.split(".");
  if (!body) return null;
  try {
    const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function scheduleSilentRefresh(session: AuthSession) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expiryMs = decodeAccessTokenPayload(session.tokens.accessToken)?.exp ?? null;
  const delay = expiryMs ? Math.max(expiryMs - Date.now() - 60_000, 30_000) : 10 * 60_000;
  refreshTimer = setTimeout(() => {
    refreshSession(session.tokens.refreshToken).catch(async () => {
      await clearPersistedSession();
      setSession(null, "session-expired");
    });
  }, delay);
}

/** Estado de sessão observável em memória (nunca persistido, nunca logado):
 * `useSession` (AccountProvider) assina isso em vez de reimplementar
 * polling/listeners Firebase-like. */
function setSession(session: AuthSession | null, error: string | null) {
  currentSession = session;
  currentError = error;
  if (session) {
    scheduleSilentRefresh(session);
  } else if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  for (const listener of listeners) listener(session ? session.user : null);
}

export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentSession(): AuthSession | null {
  return currentSession;
}

export function getSessionError(): string | null {
  return currentError;
}

/** Token de acesso atual, para o cliente HTTP de grupos/convites (issue
 * #60). Só existe em memória; nunca é persistido nem logado. */
export function getAccessToken(): string | null {
  return currentSession?.tokens.accessToken ?? null;
}

function baseUrl(): string {
  const value = import.meta.env.VITE_API_URL as string | undefined;
  if (!value) throw new AuthError("api-not-configured");
  return value.replace(/\/+$/, "");
}

function apiUrl(path: string): string {
  return `${baseUrl()}${path}`;
}

export type OAuthTarget = "browser" | "desktop";

/** URL de início do fluxo OAuth (issue #30/#1): o backend não aceita
 * `redirect_uri`/`state` do cliente, ele é quem decide pra onde volta no
 * final — só existe UM `OAUTH_FRONTEND_REDIRECT_URL` configurado por vez,
 * então hoje não dá pra testar o fallback web e o desktop (deep link) ao
 * mesmo tempo contra o mesmo backend.
 *
 * `target` já vai preparado (`?target=browser|desktop`) pro dia em que o
 * backend passar a aceitar mais de um redirect configurado e escolher com
 * base nisso — combinado com @ProgVictorPe, ainda não implementado do lado
 * dele. Até lá o backend ignora esse parâmetro (rota não declara schema de
 * querystring), então mandar já não quebra nada.
 *
 * Função pura (recebe a base em vez de ler `import.meta.env`) pra poder
 * ser testada sem ambiente Vite. */
export function buildOAuthStartUrl(apiBaseUrl: string, provider: OAuthProvider, target?: OAuthTarget): string {
  const base = `${apiBaseUrl.replace(/\/+$/, "")}/v1/auth/oauth/${provider}/start`;
  return target ? `${base}?target=${target}` : base;
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function postJson(path: string, body: unknown): Promise<any> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("network");
  }

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new AuthError(data?.error?.code ?? `http-${response.status}`, data?.error?.message);
  }
  return data;
}

function toSession(accessToken: string | undefined, refreshToken: string | undefined): AuthSession {
  const payload = accessToken ? decodeAccessTokenPayload(accessToken) : null;
  if (!accessToken || !refreshToken || !payload?.uid) {
    throw new AuthError("malformed-response");
  }
  return {
    user: { id: payload.uid, email: payload.email },
    tokens: { accessToken, refreshToken },
  };
}

export async function registerWithEmail(email: string, password: string): Promise<AuthSession> {
  const data = await postJson("/v1/auth/register", { email, password });
  const session = toSession(data.accessToken, data.refreshToken);
  await persistSession(session);
  return session;
}

export async function loginWithEmail(email: string, password: string): Promise<AuthSession> {
  const data = await postJson("/v1/auth/login", { email, password });
  const session = toSession(data.accessToken, data.refreshToken);
  await persistSession(session);
  return session;
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
  const data = await postJson("/v1/auth/refresh", { refreshToken });
  const session = toSession(data.accessToken, data.refreshToken);
  await persistSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const refreshToken = currentSession?.tokens.refreshToken ?? null;
  await clearPersistedSession();
  setSession(null, null);
  if (!refreshToken) return;
  try {
    await fetch(apiUrl("/v1/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // O logout local já aconteceu; falha ao revogar no backend não deve travar o usuário.
  }
}

type DesktopOAuthResult = { accessToken?: string; refreshToken?: string; error?: string };

/**
 * No Tauri, abre o navegador padrão do sistema pro fluxo OAuth (nunca um
 * WebView embutido — Google bloqueia login OAuth em WebView por política) e
 * espera o resultado voltar via deep link `screenshare://` (RFC 8252,
 * `src-tauri/src/desktop_auth.rs`).
 *
 * Fora do Tauri (dev em navegador), é uma navegação de verdade — não um
 * popup: o backend também navega de verdade, então esta função nunca
 * resolve nesse caminho, a página é descarregada. Quem completa o login é
 * `src/oauth.tsx`, que lê o fragmento da URL de retorno e persiste a sessão
 * antes de voltar pro app.
 */
export async function loginWithOAuth(provider: OAuthProvider): Promise<AuthSession> {
  if (isTauri()) {
    let result: DesktopOAuthResult;
    try {
      result = await invoke<DesktopOAuthResult>("desktop_oauth_login", { provider, apiUrl: baseUrl() });
    } catch (error) {
      throw new AuthError(typeof error === "string" ? error : "desktop-auth-failed");
    }
    if (result.error) throw new AuthError(result.error);
    const session = toSession(result.accessToken, result.refreshToken);
    await persistSession(session);
    return session;
  }

  location.href = buildOAuthStartUrl(baseUrl(), provider, "browser");
  return new Promise<AuthSession>(() => {});
}

/** Chamado por `src/oauth.tsx` ao carregar, com `location.hash` cru. Nunca
 * lança: em caso de erro/fragmento inválido, guarda o código em
 * `sessionStorage` pra `useSession` mostrar depois que o app recarregar. */
export async function completeOAuthFromFragment(hash: string): Promise<void> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (error) {
    setPendingOAuthError(error);
    return;
  }

  try {
    const session = toSession(accessToken ?? undefined, refreshToken ?? undefined);
    await persistSession(session);
  } catch {
    setPendingOAuthError("malformed-response");
  }
}

function setPendingOAuthError(code: string) {
  try {
    sessionStorage.setItem(OAUTH_ERROR_KEY, code);
  } catch {
    // sessionStorage indisponível — o erro simplesmente não aparece depois.
  }
}

/** Lido uma única vez por `useSession` na abertura do app (issue #1/#2:
 * mostrar o erro do OAuth depois que `oauth.tsx` já navegou de volta). */
export function consumePendingOAuthError(): string | null {
  try {
    const value = sessionStorage.getItem(OAUTH_ERROR_KEY);
    if (value) sessionStorage.removeItem(OAUTH_ERROR_KEY);
    return value;
  } catch {
    return null;
  }
}

async function persistSession(session: AuthSession): Promise<void> {
  await setStoredRefreshToken(session.tokens.refreshToken);
  setSession(session, null);
}

async function clearPersistedSession(): Promise<void> {
  await setStoredRefreshToken(null);
}

async function setStoredRefreshToken(value: string | null): Promise<void> {
  if (isTauri()) {
    try {
      if (value) await invoke("secure_store_set", { key: REFRESH_TOKEN_KEY, value });
      else await invoke("secure_store_delete", { key: REFRESH_TOKEN_KEY });
    } catch {
      // Armazenamento seguro indisponível: a sessão não sobrevive ao restart,
      // mas o login continua funcional dentro da execução atual.
    }
    return;
  }
  try {
    if (value) sessionStorage.setItem(REFRESH_TOKEN_KEY, value);
    else sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // sessionStorage indisponível (ex.: modo privado).
  }
}

async function getStoredRefreshToken(): Promise<string | null> {
  if (isTauri()) {
    try {
      return (await invoke<string | null>("secure_store_get", { key: REFRESH_TOKEN_KEY })) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Restaura a sessão na abertura do app trocando o refresh token guardado
 * por um novo par de tokens (issue #2: "abertura restaura sessão válida").
 * Também recolhe um eventual erro de OAuth pendente de `oauth.tsx`. */
export async function restoreSession(): Promise<AuthSession | null> {
  const pendingOAuthError = consumePendingOAuthError();
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) {
    setSession(null, pendingOAuthError);
    return null;
  }
  try {
    return await refreshSession(refreshToken);
  } catch {
    await clearPersistedSession();
    setSession(null, pendingOAuthError ?? "session-expired");
    return null;
  }
}

const CLIENT_ONLY_MESSAGES: Record<string, string> = {
  network: "falha de rede. confira sua conexao e tente novamente",
  "api-not-configured": "configure o backend (VITE_API_URL) primeiro",
  "malformed-response": "resposta inesperada do servidor. tente novamente",
  "session-expired": "sua sessao expirou. entre novamente",
  // Códigos do backend (docs/BACKEND.md §4), compartilhados pelos dois
  // transportes (desktop via deep link, web via fragmento da URL).
  invalid_state: "a tentativa de login expirou ou e invalida. tente novamente",
  missing_code: "o provedor nao retornou os dados esperados. tente novamente",
  provider_error: "nao foi possivel completar o login com o provedor. tente novamente",
  provider_not_configured: "esse provedor ainda nao foi configurado no backend",
  provider_unknown: "provedor de login invalido",
  // Só do transporte desktop (loop local em src-tauri/src/desktop_auth.rs).
  "desktop-auth-cancelled": "login cancelado",
  "desktop-auth-timeout": "o login expirou. tente novamente",
  "desktop-auth-busy": "conclua a tentativa de login aberta no navegador",
  "desktop-auth-failed": "nao foi possivel abrir o login no navegador. tente novamente",
  "desktop-invalid-provider": "provedor de login invalido",
  "desktop-server-failed": "nao foi possivel iniciar o login. tente novamente",
  "desktop-browser-failed": "nao foi possivel abrir o navegador. tente novamente",
};

/** Mensagens de erro do backend (envelope `{ error: { code, message } }`) já
 * chegam em pt-BR seguras para exibir; só os códigos gerados no cliente
 * (rede, sessão, fluxo desktop) e os 5 códigos de erro do OAuth (que
 * chegam como string crua, sem envelope, no fragmento/deep link) precisam
 * de tradução aqui. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.message && error.message !== error.code) return error.message;
    return CLIENT_ONLY_MESSAGES[error.code] ?? `nao foi possivel entrar (${error.code})`;
  }
  return "nao foi possivel entrar. tente novamente";
}
