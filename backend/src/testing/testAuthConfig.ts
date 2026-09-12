import type { AppConfig } from "../config.js";

/** Config de auth válida e mínima só pra testes — nunca usar fora de src/**\/*.test.ts. */
export function testAuthConfig(overrides: Partial<AppConfig["auth"]> = {}): AppConfig["auth"] {
  return {
    sessionSigningSecret: "a".repeat(32),
    passwordPepper: "b".repeat(16),
    oauthRedirectBaseUrl: "http://127.0.0.1:8787",
    oauthFrontendRedirectUrl: "http://127.0.0.1:5173/oauth.html",
    oauthProviders: {},
    ...overrides,
  };
}
