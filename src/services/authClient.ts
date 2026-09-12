import { invoke, isTauri } from "@tauri-apps/api/core";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  photoURL?: string;
};

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

type SessionListener = (user: SessionUser | null) => void;
let currentSession: AuthSession | null = null;
let currentError: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<SessionListener>();

function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleSilentRefresh(session: AuthSession) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expiryMs = decodeJwtExpiryMs(session.tokens.accessToken);
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

/** Monta a URL de início do fluxo OAuth (issue #30/#1): o backend recebe
 * `redirect_uri` e `state` via query params e devolve, ao final, o mesmo
 * `state` e um `handoff_code` de uso único — nunca o token em si — para o
 * `redirect_uri` informado. Função pura (recebe a base em vez de ler
 * `import.meta.env`) para poder ser testada sem ambiente Vite. */
export function buildOAuthStartUrl(apiBaseUrl: string, provider: OAuthProvider, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ redirect_uri: redirectUri, state });
  return `${apiBaseUrl.replace(/\/+$/, "")}/v1/auth/oauth/${provider}/start?${params.toString()}`;
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

function toSession(data: any): AuthSession {
  if (!data?.user?.id || !data?.accessToken || !data?.refreshToken) {
    throw new AuthError("malformed-response");
  }
  return {
    user: { id: data.user.id, name: data.user.name, email: data.user.email, photoURL: data.user.photoURL ?? undefined },
    tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
  };
}

export async function registerWithEmail(name: string, email: string, password: string): Promise<AuthSession> {
  const session = toSession(await postJson("/v1/auth/register", { name, email, password }));
  await persistSession(session);
  return session;
}

export async function loginWithEmail(email: string, password: string): Promise<AuthSession> {
  const session = toSession(await postJson("/v1/auth/login", { email, password }));
  await persistSession(session);
  return session;
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
  const session = toSession(await postJson("/v1/auth/refresh", { refreshToken }));
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

async function exchangeHandoffCode(handoffCode: string): Promise<AuthSession> {
  const session = toSession(await postJson("/v1/auth/oauth/exchange", { handoffCode }));
  await persistSession(session);
  return session;
}

type DesktopOAuthResult = { handoffCode?: string; error?: string };

export async function loginWithOAuth(provider: OAuthProvider): Promise<AuthSession> {
  if (isTauri()) {
    let result: DesktopOAuthResult;
    try {
      result = await invoke<DesktopOAuthResult>("desktop_oauth_login", { provider, apiUrl: baseUrl() });
    } catch (error) {
      throw new AuthError(typeof error === "string" ? error : "desktop-auth-failed");
    }
    if (result.error) throw new AuthError(result.error);
    if (!result.handoffCode) throw new AuthError("desktop-auth-failed");
    return exchangeHandoffCode(result.handoffCode);
  }
  return loginWithOAuthInBrowser(provider);
}

/** Fallback para desenvolvimento em navegador (`npm run dev` fora do Tauri):
 * abre um popup para o backend e recebe o `handoff_code` via postMessage de
 * `oauth.html`, servido pelo próprio Vite/estático. */
function loginWithOAuthInBrowser(provider: OAuthProvider): Promise<AuthSession> {
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID();
    const redirectUri = `${location.origin}/oauth.html`;
    let popup: Window | null;
    try {
      popup = window.open(buildOAuthStartUrl(baseUrl(), provider, redirectUri, state), "screenshare-oauth", "width=480,height=640");
    } catch (error) {
      reject(error instanceof AuthError ? error : new AuthError("api-not-configured"));
      return;
    }
    if (!popup) {
      reject(new AuthError("popup-blocked"));
      return;
    }

    let settled = false;
    const poll = window.setInterval(() => {
      if (popup!.closed) finish(() => reject(new AuthError("popup-closed-by-user")));
    }, 500);

    function finish(handler: () => void) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
      handler();
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== location.origin || !event.data || event.data.type !== "screenshare-oauth") return;
      const { state: returnedState, handoffCode, error } = event.data as { state?: string; handoffCode?: string; error?: string };
      if (returnedState !== state) return;
      finish(() => {
        popup?.close();
        if (error) {
          reject(new AuthError(error));
        } else if (!handoffCode) {
          reject(new AuthError("popup-missing-code"));
        } else {
          exchangeHandoffCode(handoffCode).then(resolve, reject);
        }
      });
    }

    window.addEventListener("message", onMessage);
  });
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
 * por um novo par de tokens (issue #2: "abertura restaura sessão válida"). */
export async function restoreSession(): Promise<AuthSession | null> {
  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) {
    setSession(null, null);
    return null;
  }
  try {
    return await refreshSession(refreshToken);
  } catch {
    await clearPersistedSession();
    setSession(null, "session-expired");
    return null;
  }
}

const CLIENT_ONLY_MESSAGES: Record<string, string> = {
  network: "falha de rede. confira sua conexao e tente novamente",
  "api-not-configured": "configure o backend (VITE_API_URL) primeiro",
  "malformed-response": "resposta inesperada do servidor. tente novamente",
  "popup-blocked": "o navegador bloqueou a janela de login. permita popups e tente novamente",
  "popup-closed-by-user": "login cancelado",
  "popup-missing-code": "nao foi possivel concluir o login. tente novamente",
  "desktop-auth-cancelled": "login cancelado",
  "desktop-auth-timeout": "o login expirou. tente novamente",
  "desktop-auth-busy": "conclua a tentativa de login aberta no navegador",
  "desktop-auth-network": "falha de rede. confira sua conexao e tente novamente",
  "desktop-auth-provider-failed": "o provedor recusou o login. tente novamente",
  "desktop-auth-failed": "nao foi possivel abrir o login no navegador. tente novamente",
  "desktop-invalid-provider": "provedor de login invalido",
  "desktop-server-failed": "nao foi possivel iniciar o login local. tente novamente",
  "desktop-browser-failed": "nao foi possivel abrir o navegador. tente novamente",
  "session-expired": "sua sessao expirou. entre novamente",
};

/** Mensagens de erro do backend (envelope `{ error: { code, message } }`) já
 * chegam em pt-BR seguras para exibir; só os códigos gerados no cliente
 * (rede, popup, fluxo desktop) precisam de tradução aqui. */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.message && error.message !== error.code) return error.message;
    return CLIENT_ONLY_MESSAGES[error.code] ?? `nao foi possivel entrar (${error.code})`;
  }
  return "nao foi possivel entrar. tente novamente";
}
