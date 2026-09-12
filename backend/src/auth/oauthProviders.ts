export type OAuthProviderName = "google" | "github" | "discord";

export interface OAuthProfile {
  providerAccountId: string;
  email?: string;
}

export class OAuthProviderError extends Error {}

/**
 * Um provedor OAuth 2.0 (issue #30: Google, GitHub, Discord). Endpoints
 * confirmados nas docs oficiais de cada um em 2026-09-12 — ver
 * docs/backend/ARQUITETURA.md. `exchangeCode`/`fetchProfile` fazem chamada
 * de rede real; testes usam um fake que implementa a mesma interface, sem
 * bater na rede (igual ao TokenVerifier de #30 original).
 */
export interface OAuthProvider {
  readonly name: OAuthProviderName;
  authorizeUrl(params: { clientId: string; redirectUri: string; state: string }): string;
  exchangeCode(params: { code: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<string>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
}

async function parseJsonOrThrow(response: Response, context: string): Promise<any> {
  if (!response.ok) {
    throw new OAuthProviderError(`${context}: resposta ${response.status} do provedor.`);
  }
  return response.json();
}

export const googleProvider: OAuthProvider = {
  name: "google",

  authorizeUrl({ clientId, redirectUri, state }) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode({ code, redirectUri, clientId, clientSecret }) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const data = await parseJsonOrThrow(response, "Troca de código Google");
    if (!data.access_token) throw new OAuthProviderError("Google não retornou access_token.");
    return data.access_token as string;
  },

  async fetchProfile(accessToken) {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await parseJsonOrThrow(response, "Perfil Google");
    if (!data.sub) throw new OAuthProviderError("Google não retornou identificador de usuário (sub).");
    return { providerAccountId: String(data.sub), email: data.email ?? undefined };
  },
};

export const githubProvider: OAuthProvider = {
  name: "github",

  authorizeUrl({ clientId, redirectUri, state }) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode({ code, redirectUri, clientId, clientSecret }) {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const data = await parseJsonOrThrow(response, "Troca de código GitHub");
    if (!data.access_token) throw new OAuthProviderError("GitHub não retornou access_token.");
    return data.access_token as string;
  },

  async fetchProfile(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}`, "User-Agent": "screenshare-backend" };
    const response = await fetch("https://api.github.com/user", { headers });
    const user = await parseJsonOrThrow(response, "Perfil GitHub");
    if (!user.id) throw new OAuthProviderError("GitHub não retornou identificador de usuário.");

    let email: string | undefined = user.email ?? undefined;
    if (!email) {
      // E-mail privado não vem em /user — precisa do endpoint dedicado.
      const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as { email: string; primary: boolean; verified: boolean }[];
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email;
      }
    }

    return { providerAccountId: String(user.id), email };
  },
};

export const discordProvider: OAuthProvider = {
  name: "discord",

  authorizeUrl({ clientId, redirectUri, state }) {
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "identify email");
    url.searchParams.set("state", state);
    return url.toString();
  },

  async exchangeCode({ code, redirectUri, clientId, clientSecret }) {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    const data = await parseJsonOrThrow(response, "Troca de código Discord");
    if (!data.access_token) throw new OAuthProviderError("Discord não retornou access_token.");
    return data.access_token as string;
  },

  async fetchProfile(accessToken) {
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await parseJsonOrThrow(response, "Perfil Discord");
    if (!data.id) throw new OAuthProviderError("Discord não retornou identificador de usuário.");
    return { providerAccountId: String(data.id), email: data.email ?? undefined };
  },
};

export const OAUTH_PROVIDERS: Record<OAuthProviderName, OAuthProvider> = {
  google: googleProvider,
  github: githubProvider,
  discord: discordProvider,
};
