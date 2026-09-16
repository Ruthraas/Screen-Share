import type { OAuthProvider, OAuthProviderName, OAuthProfile } from "../auth/oauthProviders.js";
import { OAuthProviderError } from "../auth/oauthProviders.js";

/**
 * Provedor OAuth falso pra testes — nunca bate na rede. "code-<id>" troca
 * por um "token-<id>" válido; "code-falha" simula erro do provedor na
 * troca de código.
 */
export function fakeOAuthProvider(name: OAuthProviderName, profileByCode: Record<string, OAuthProfile>): OAuthProvider {
  return {
    name,
    authorizeUrl({ clientId, redirectUri, state }) {
      const url = new URL(`https://fake-${name}.example/authorize`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      return url.toString();
    },
    async exchangeCode({ code }) {
      if (code === "code-falha") throw new OAuthProviderError("Falha simulada na troca de código.");
      if (!(code in profileByCode)) throw new OAuthProviderError("Código desconhecido no fake provider.");
      return `token-${code}`;
    },
    async fetchProfile(accessToken) {
      const code = accessToken.replace("token-", "");
      return profileByCode[code];
    },
  };
}
