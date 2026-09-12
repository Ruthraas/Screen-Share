import { TokenVerificationError, type AuthIdentity, type TokenVerifier } from "../auth/verifier.js";

/**
 * Verificador falso para testes — nunca usar fora de src/**\/*.test.ts.
 * "valid-token" resolve para uma identidade fixa; qualquer outro valor
 * (incluindo "expired-token") rejeita como token inválido/expirado.
 */
export class FakeTokenVerifier implements TokenVerifier {
  async verify(idToken: string): Promise<AuthIdentity> {
    if (idToken === "valid-token") {
      return { uid: "usr_123", email: "usuario@example.com" };
    }
    throw new TokenVerificationError("Token inválido ou expirado.");
  }
}
