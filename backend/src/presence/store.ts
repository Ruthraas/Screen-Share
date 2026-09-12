export interface PresenceEntry {
  userId: string;
  online: boolean;
  lastSeenAt: string;
}

/**
 * Presença por heartbeat com expiração (issue #36) — puramente em memória,
 * nunca persistida (isso é regra explícita da issue #31/#36: presença
 * efêmera não vai pro banco). Não serve como prova de autorização — quem
 * chama precisa checar membership separadamente (src/authz/policy.ts).
 */
export class PresenceStore {
  private readonly ttlMs: number;
  private readonly groups = new Map<string, Map<string, number>>();

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  heartbeat(groupId: string, userId: string, now: number = Date.now()): void {
    let group = this.groups.get(groupId);
    if (!group) {
      group = new Map();
      this.groups.set(groupId, group);
    }
    group.set(userId, now);
  }

  remove(groupId: string, userId: string): void {
    this.groups.get(groupId)?.delete(userId);
  }

  /** Lista membros ainda dentro do TTL; expira (e limpa) quem passou do prazo. */
  list(groupId: string, now: number = Date.now()): PresenceEntry[] {
    const group = this.groups.get(groupId);
    if (!group) return [];

    const result: PresenceEntry[] = [];
    for (const [userId, lastSeenAt] of group) {
      if (now - lastSeenAt > this.ttlMs) {
        group.delete(userId);
        continue;
      }
      result.push({ userId, online: true, lastSeenAt: new Date(lastSeenAt).toISOString() });
    }
    return result;
  }
}
