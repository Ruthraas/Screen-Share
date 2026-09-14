import type { IceServer, TurnCredentialsProvider } from "../turn/cloudflareTurnProvider.js";
import { UpstreamError } from "../errors.js";

/** Provider de TURN falso — só para testes, nunca chama a Cloudflare de verdade. */
export function fakeTurnProvider(iceServers: IceServer[] = [{ urls: ["turn:fake.example:3478"], username: "u", credential: "c" }]): TurnCredentialsProvider {
  return {
    async generateIceServers() {
      return iceServers;
    },
  };
}

/** Simula a Cloudflare fora do ar — para testar o mapeamento de erro (502). */
export function failingTurnProvider(message = "TURN indisponível (teste)"): TurnCredentialsProvider {
  return {
    async generateIceServers() {
      throw new UpstreamError(message);
    },
  };
}
