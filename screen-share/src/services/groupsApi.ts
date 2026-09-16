import { apiUrl, getAccessToken, getCurrentSession, refreshSession } from "./authClient";
import type { ApiGroup, ApiGroupDetail, Invite, PresenceEntry } from "../data/types";

/**
 * Erro de uma chamada a /v1/groups|invites (issue #60). `message` já vem
 * pt-BR seguro pra exibir quando o backend respondeu (mesmo envelope de
 * `authClient.ts`); `code`/`correlationId` ficam disponíveis pra quem
 * precisar diferenciar 401/403/404/409/422 ou correlacionar com suporte.
 */
export class ApiError extends Error {
  code: string;
  status: number;
  correlationId?: string;
  constructor(code: string, message: string, status: number, correlationId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
  }
}

async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Toda chamada autenticada passa por aqui: renova o token expirado UMA
 * vez (issue #60: "sem loop de retry") antes de desistir. */
async function request(path: string, init: RequestInit = {}, isRetry = false): Promise<any> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new ApiError("unauthenticated", "sessao nao encontrada. entre novamente", 401);

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw new ApiError("network", "falha de rede. confira sua conexao e tente novamente", 0);
  }

  if (response.status === 401 && !isRetry) {
    const session = getCurrentSession();
    if (session) {
      try {
        await refreshSession(session.tokens.refreshToken);
        return request(path, init, true);
      } catch {
        // refresh falhou de verdade (ex.: refresh token também expirado) — segue pro tratamento de erro normal abaixo.
      }
    }
  }

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new ApiError(data?.error?.code ?? `http-${response.status}`, data?.error?.message ?? "nao foi possivel completar a operacao", response.status, data?.error?.correlationId);
  }
  return data;
}

const groupPath = (groupId: string) => `/v1/groups/${encodeURIComponent(groupId)}`;

export async function listGroups(): Promise<ApiGroup[]> {
  const data = await request("/v1/groups");
  return data.groups ?? [];
}

export async function createGroup(name: string): Promise<ApiGroup> {
  return request("/v1/groups", { method: "POST", body: JSON.stringify({ name }) });
}

export async function getGroup(groupId: string): Promise<ApiGroupDetail> {
  return request(groupPath(groupId));
}

export async function updateGroup(groupId: string, name: string): Promise<ApiGroup> {
  return request(groupPath(groupId), { method: "PATCH", body: JSON.stringify({ name }) });
}

export async function deleteGroup(groupId: string): Promise<void> {
  await request(groupPath(groupId), { method: "DELETE" });
}

export async function leaveGroup(groupId: string): Promise<void> {
  await request(`${groupPath(groupId)}/leave`, { method: "POST" });
}

export async function createInvite(groupId: string, options?: { expiresInMinutes?: number; maxUses?: number }): Promise<Invite> {
  return request(`${groupPath(groupId)}/invites`, { method: "POST", body: options ? JSON.stringify(options) : undefined });
}

export async function listInvites(groupId: string): Promise<Invite[]> {
  const data = await request(`${groupPath(groupId)}/invites`);
  return data.invites ?? [];
}

export async function revokeInvite(groupId: string, inviteId: string): Promise<void> {
  await request(`${groupPath(groupId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export async function acceptInvite(token: string): Promise<ApiGroup> {
  return request(`/v1/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
}

/** Presença real (backend, issue #36) — nunca tinha sido consumida pelo
 * cliente antes: `online`/`activeStreams` de `Group` sempre foram
 * hardcoded (`members: []`/`activeStreams: 0` em `AccountProvider.toGroup`,
 * `online: false` em todo membro que não o próprio usuário), mostrando
 * "0 online" mesmo com gente de verdade conectada. TTL da sessão de
 * presença no backend é 30s (`backend/src/presence/store.ts`) — heartbeat
 * chamado bem mais frequente que isso (ver `PRESENCE_POLL_INTERVAL_MS` em
 * `AccountProvider.tsx`) pra nunca deixar a própria sessão expirar. */
export async function sendPresenceHeartbeat(groupId: string): Promise<void> {
  await request(`${groupPath(groupId)}/presence/heartbeat`, { method: "POST" });
}

export async function getPresence(groupId: string): Promise<PresenceEntry[]> {
  const data = await request(`${groupPath(groupId)}/presence`);
  return data.members ?? [];
}
