import { randomBytes, createHash } from "node:crypto";
import { signPayload, verifyPayload, SignatureError } from "./signedPayload.js";
import { TokenVerificationError, type AuthIdentity } from "./verifier.js";

const ACCESS_TOKEN_TTL_MS = 15 * 60_000; // 15 min — curto de propósito, refresh cobre o resto.
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 dias.

interface AccessTokenPayload {
  uid: string;
  email?: string;
  exp: number;
}

/** Token de acesso de vida curta, assinado, sem consulta ao banco pra verificar. */
export function issueAccessToken(identity: AuthIdentity, secret: string): string {
  const payload: AccessTokenPayload = { uid: identity.uid, email: identity.email, exp: Date.now() + ACCESS_TOKEN_TTL_MS };
  return signPayload(payload, secret);
}

export function verifyAccessToken(token: string, secret: string): AuthIdentity {
  let payload: AccessTokenPayload;
  try {
    payload = verifyPayload<AccessTokenPayload>(token, secret);
  } catch (err) {
    if (err instanceof SignatureError) throw new TokenVerificationError("Token inválido ou expirado.");
    throw err;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    throw new TokenVerificationError("Token inválido ou expirado.");
  }
  return { uid: payload.uid, email: payload.email };
}

/** Refresh token opaco: só o hash fica no banco, nunca o valor em si (igual senha). */
export function newRefreshTokenValue(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
