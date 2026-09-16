import { TokenVerificationError, type AuthIdentity, type TokenVerifier } from "../auth/verifier.js";

/**
 * Verificador falso para testes — nunca usar fora de src/**\/*.test.ts.
 * "valid-token" resolve para uma identidade fixa; "user:<uid>" resolve
 * para essa identidade (útil em testes com vários usuários distintos,
 * ex. owner/member/outsider); qualquer outro valor rejeita como token
 * inválido/expirado.
 */
export class FakeTokenVerifier implements TokenVerifier {
  async verify(idToken: string): Promise<AuthIdentity> {
    if (idToken === "valid-token") {
      return { uid: "usr_123", email: "usuario@example.com" };
    }
    const match = /^user:(.+)$/.exec(idToken);
    if (match) {
      return { uid: match[1] };
    }
    throw new TokenVerificationError("Token inválido ou expirado.");
  }
}
