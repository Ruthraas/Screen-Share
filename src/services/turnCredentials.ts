import { apiUrl, getAccessToken, getCurrentSession, refreshSession } from "./authClient";

/**
 * Credenciais TURN de curta duração (issue #41, backend) — `POST
 * /v1/turn-credentials` já devolve `iceServers` no formato exato que
 * `RTCPeerConnection({ iceServers })` espera (STUN + TURN da Cloudflare
 * Realtime, ver `docs/WEBRTC_TURN_PLAN.md`); nunca montar/filtrar essa lista
 * aqui, só repassar.
 */
export type TurnCredentials = { iceServers: RTCIceServer[]; ttlSeconds: number };

/** Mesmo padrão de retry-uma-vez de `groupsApi.ts` — duplicado em vez de
 * reexportado porque o `request()` de lá é privado ao módulo, e esta é a
 * única chamada TURN do cliente (não justifica virar API pública só por
 * isso). */
export async function fetchTurnCredentials(isRetry = false): Promise<TurnCredentials> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new Error("sessao nao encontrada. entre novamente");

  const response = await fetch(apiUrl("/v1/turn-credentials"), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401 && !isRetry) {
    const session = getCurrentSession();
    if (session) {
      try {
        await refreshSession(session.tokens.refreshToken);
        return fetchTurnCredentials(true);
      } catch {
        // refresh falhou de verdade — segue pro erro genérico abaixo.
      }
    }
  }

  if (!response.ok) throw new Error(`nao foi possivel obter credenciais TURN (http-${response.status})`);
  const data = await response.json();
  return { iceServers: data.iceServers, ttlSeconds: data.ttlSeconds };
}
