import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AppConfig } from "../config.js";
import { TokenVerificationError, type AuthIdentity, type TokenVerifier } from "./verifier.js";

type AuthConfig = AppConfig["auth"];

function loadServiceAccount(config: AuthConfig): ServiceAccount {
  const raw = config.firebaseServiceAccountJson
    ? config.firebaseServiceAccountJson
    : config.firebaseServiceAccountPath
      ? readFileSync(config.firebaseServiceAccountPath, "utf-8")
      : undefined;

  if (!raw) {
    // loadConfig() já garante que um dos dois existe; isto é defesa extra.
    throw new Error("Nenhuma credencial Firebase configurada");
  }

  return JSON.parse(raw) as ServiceAccount;
}

let cachedApp: App | undefined;

function getFirebaseApp(config: AuthConfig): App {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  cachedApp = initializeApp({ credential: cert(loadServiceAccount(config)) });
  return cachedApp;
}

/**
 * Verificação real de token via Firebase Admin (issue #30). Nunca loga o
 * token nem o conteúdo da service account.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly authConfig: AuthConfig) {}

  async verify(idToken: string): Promise<AuthIdentity> {
    try {
      const app = getFirebaseApp(this.authConfig);
      const decoded = await getAuth(app).verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    } catch {
      throw new TokenVerificationError("Token inválido ou expirado.");
    }
  }
}
