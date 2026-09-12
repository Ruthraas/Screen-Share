import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  GithubAuthProvider,
  GoogleAuthProvider,
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  updateProfile,
  type AuthError,
  type UserCredential,
} from "firebase/auth";
import { invoke, isTauri } from "@tauri-apps/api/core";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;

function ensureAuth() {
  if (!auth) {
    throw new Error("firebase-not-configured");
  }

  return auth;
}

export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(ensureAuth(), email, password);
}

export async function createAccountWithEmail(name: string, email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(ensureAuth(), email, password);

  if (name.trim()) {
    await updateProfile(credential.user, { displayName: name.trim() });
  }

  return credential;
}

export function loginWithGoogle() {
  if (isTauri()) return loginDesktop("google");
  return signInWithPopup(ensureAuth(), new GoogleAuthProvider());
}

export function loginWithGithub() {
  if (isTauri()) return loginDesktop("github");
  const provider = new GithubAuthProvider();
  provider.addScope("read:user");
  provider.addScope("user:email");

  return signInWithPopup(ensureAuth(), provider);
}

type DesktopCredential = { idToken?: string; accessToken?: string; error?: string };
async function loginDesktop(provider: "google" | "github") {
  const target = ensureAuth();
  let result: DesktopCredential;
  try { result = await invoke<DesktopCredential>("desktop_login", { provider }); }
  catch (error) { throw new Error(typeof error === "string" ? error : "desktop-auth-failed"); }
  if (result.error) throw Object.assign(new Error(result.error), { code: result.error });
  const credential = provider === "google"
    ? GoogleAuthProvider.credential(result.idToken, result.accessToken)
    : GithubAuthProvider.credential(result.accessToken!);
  return signInWithCredential(target, credential);
}

export function authErrorMessage(error: unknown) {
  if (error instanceof Error && error.message === "firebase-not-configured") {
    return "configure o firebase primeiro";
  }

  const code = (error as AuthError | undefined)?.code;
  const messages: Record<string, string> = {
    "auth/popup-blocked": "o navegador bloqueou a janela de login. permita popups e tente novamente",
    "auth/operation-not-allowed": "ative este provedor no firebase authentication",
    "auth/operation-not-supported-in-this-environment": "este ambiente nao suporta o popup. use o login desktop pelo navegador",
    "auth/network-request-failed": "falha de rede. confira sua conexao e tente novamente",
    "auth/invalid-api-key": "a chave de configuracao do firebase e invalida",
    "auth/session-failed": "nao foi possivel restaurar sua sessao. entre novamente",
    "auth/invalid-email": "informe um email valido",
    "auth/too-many-requests": "muitas tentativas. aguarde antes de tentar novamente",
    "auth/cancelled-popup-request": "ja existe uma tentativa de login em andamento",
  };
  if (code && messages[code]) return messages[code];

  if (code === "auth/account-exists-with-different-credential") {
    return "esse email ja existe com outro provedor";
  }

  if (code === "auth/popup-closed-by-user") {
    return "login cancelado";
  }

  if (code === "auth/unauthorized-domain") {
    return "autorize 127.0.0.1 nos dominios do firebase authentication para o login desktop";
  }

  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "email ou senha invalidos";
  }

  if (code === "auth/email-already-in-use") {
    return "email ja cadastrado";
  }

  if (code === "auth/weak-password") {
    return "senha muito fraca";
  }

  if (error instanceof Error && error.message.startsWith("desktop-")) {
    if (error.message === "desktop-auth-timeout") return "o login expirou. tente novamente e conclua no navegador";
    if (error.message === "desktop-auth-busy") return "conclua a tentativa de login aberta no navegador";
    if (error.message === "desktop-auth-cancelled") return "login cancelado";
    if (error.message === "desktop-auth-network") return "falha de rede. confira sua conexao e tente novamente";
    if (error.message === "desktop-auth-unauthorized-domain") return "autorize 127.0.0.1 nos dominios do firebase authentication";
    if (error.message === "desktop-auth-provider-disabled") return "ative este provedor no firebase authentication";
    if (error.message === "desktop-auth-provider-failed") return "o provedor recusou o login. confira a configuracao e tente novamente";
    return "nao foi possivel abrir o login no navegador. tente novamente";
  }
  return code ? `nao foi possivel entrar (${code})` : "nao foi possivel entrar. tente novamente";
}

export type AuthResult = UserCredential;
