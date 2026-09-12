import type { AuthIdentity, TokenVerifier } from "./verifier.js";
import { verifyAccessToken } from "./sessionTokens.js";

/**
 * Verificação de token de sessão emitido pelo próprio backend (issue #30) —
 * substitui o FirebaseTokenVerifier. Sem consulta ao banco: o token já é
 * autoverificável (HMAC + expiração), o que mantém o middleware rápido em
 * toda requisição.
 */
export class SessionTokenVerifier implements TokenVerifier {
  constructor(private readonly signingSecret: string) {}

  async verify(token: string): Promise<AuthIdentity> {
    return verifyAccessToken(token, this.signingSecret);
  }
}
