import { UpstreamError } from "../errors.js";

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnCredentialsProvider {
  generateIceServers(ttlSeconds: number): Promise<IceServer[]>;
}

/**
 * Cloudflare Realtime TURN (issue #40/#41) — serviço gerenciado, não um
 * coturn autogerenciado (decisão registrada em docs/backend/ARQUITETURA.md).
 * `fetch` nativo do Node, sem SDK de terceiro — mesma filosofia de
 * `src/auth/oauthProviders.ts`. Endpoint e formato confirmados na doc
 * oficial em 2026-09-14: https://developers.cloudflare.com/realtime/turn/generate-credentials/
 *
 * A resposta da Cloudflare já vem no formato exato que
 * `RTCPeerConnection({ iceServers })` espera — o backend só repassa
 * (nunca decide STUN/TURN nem monta URL por conta própria).
 */
export function cloudflareTurnProvider(keyId: string, apiToken: string): TurnCredentialsProvider {
  return {
    async generateIceServers(ttlSeconds: number): Promise<IceServer[]> {
      let response: Response;
      try {
        response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: ttlSeconds }),
        });
      } catch {
        throw new UpstreamError("Não foi possível contatar o serviço de TURN.");
      }

      if (!response.ok) {
        throw new UpstreamError(`Serviço de TURN respondeu ${response.status}.`);
      }

      const data = (await response.json()) as { iceServers?: IceServer[] };
      if (!Array.isArray(data.iceServers)) {
        throw new UpstreamError("Resposta inesperada do serviço de TURN.");
      }
      return data.iceServers;
    },
  };
}
