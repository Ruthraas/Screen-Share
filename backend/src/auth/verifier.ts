export interface AuthIdentity {
  uid: string;
  email?: string;
  /** Nome/avatar do provedor OAuth usado no último login (issue #70) — nunca existe pra conta só-senha. */
  displayName?: string;
  avatarUrl?: string;
}

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenVerificationError";
  }
}

/**
 * Verifica um token de identidade e devolve a identidade normalizada.
 * Nunca deve confiar em nada enviado pelo cliente além do próprio token
 * (issue #30: "não confiar em UID enviado no corpo").
 */
export interface TokenVerifier {
  verify(idToken: string): Promise<AuthIdentity>;
}
