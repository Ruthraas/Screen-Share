import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Payload JSON assinado com HMAC-SHA256 e com expiração — base de tanto o
 * access token de sessão quanto o `state` do OAuth (issue #30: "state
 * assinado e expirável"). Formato: base64url(json) + "." + base64url(hmac).
 * Verificação em tempo constante (timingSafeEqual) contra adulteração.
 */
export function signPayload(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export class SignatureError extends Error {}

export function verifyPayload<T>(token: string, secret: string): T {
  const parts = token.split(".");
  if (parts.length !== 2) throw new SignatureError("Formato de token inválido.");
  const [body, signature] = parts;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new SignatureError("Assinatura inválida.");
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as T;
  } catch {
    throw new SignatureError("Payload malformado.");
  }
}
