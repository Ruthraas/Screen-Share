import type { Client } from "@libsql/client";
import type { Role } from "../authz/policy.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { newGroupId, newInviteId, newInviteToken, nowIso } from "./ids.js";

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  role: Role;
  createdAt: string;
}

export interface Member {
  userId: string;
  role: Role;
}

export interface GroupDetail extends Group {
  members: Member[];
}

export interface Invite {
  id: string;
  token: string;
  groupId: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
}

interface GroupRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  group_id: string;
  token: string;
  created_by: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  revoked_at: string | null;
}

function toInvite(row: Pick<InviteRow, "id" | "token" | "group_id" | "expires_at" | "max_uses" | "used_count">): Invite {
  return {
    id: row.id,
    token: row.token,
    groupId: row.group_id,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
  };
}

/**
 * Acesso a dados de grupos/membros/convites (issues #32, #33, #34).
 * Toda checagem de autorização acontece fora daqui (src/authz/policy.ts) —
 * este módulo só executa o que já foi autorizado pelo chamador.
 *
 * Issue #82: migrado de `better-sqlite3` (síncrono) pra Turso/libSQL
 * (assíncrono) — todo método agora devolve Promise.
 */
export class GroupsRepository {
  constructor(private readonly db: Client) {}

  async getRole(groupId: string, userId: string): Promise<Role | undefined> {
    const rs = await this.db.execute({
      sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
      args: [groupId, userId],
    });
    const row = rs.rows[0] as unknown as { role: Role } | undefined;
    return row?.role;
  }

  /** `batch` (issue #82): as duas escritas não dependem de nenhuma leitura
   * anterior nem de decisão condicional — não precisa da transação
   * interativa, o batch não-interativo do libSQL já garante atomicidade. */
  async createGroup(name: string, ownerId: string): Promise<Group> {
    const id = newGroupId();
    const createdAt = nowIso();
    await this.db.batch(
      [
        { sql: "INSERT INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)", args: [id, name, ownerId, createdAt] },
        { sql: "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", args: [id, ownerId, createdAt] },
      ],
      "write",
    );
    return { id, name, ownerId, role: "owner", createdAt };
  }

  async listGroupsForUser(userId: string): Promise<Group[]> {
    const rs = await this.db.execute({
      sql: `SELECT g.id, g.name, g.owner_id, g.created_at, m.role
            FROM groups g
            JOIN group_members m ON m.group_id = g.id
            WHERE m.user_id = ?
            ORDER BY g.created_at ASC`,
      args: [userId],
    });
    const rows = rs.rows as unknown as (GroupRow & { role: Role })[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      role: row.role,
    }));
  }

  /** undefined se o grupo não existe OU o usuário não é membro — o chamador decide como responder (ver authz/policy.ts). */
  async getGroupForUser(groupId: string, userId: string): Promise<GroupDetail | undefined> {
    const role = await this.getRole(groupId, userId);
    if (!role) return undefined;

    const groupRs = await this.db.execute({ sql: "SELECT id, name, owner_id, created_at FROM groups WHERE id = ?", args: [groupId] });
    const group = groupRs.rows[0] as unknown as GroupRow | undefined;
    if (!group) return undefined;

    const membersRs = await this.db.execute({
      sql: "SELECT user_id, role FROM group_members WHERE group_id = ? ORDER BY joined_at ASC",
      args: [groupId],
    });
    const members = membersRs.rows as unknown as { user_id: string; role: Role }[];

    return {
      id: group.id,
      name: group.name,
      ownerId: group.owner_id,
      createdAt: group.created_at,
      role,
      members: members.map((m) => ({ userId: m.user_id, role: m.role })),
    };
  }

  async updateGroupName(groupId: string, name: string): Promise<void> {
    const rs = await this.db.execute({ sql: "UPDATE groups SET name = ? WHERE id = ?", args: [name, groupId] });
    if (rs.rowsAffected === 0) throw new NotFoundError("Grupo não encontrado.");
  }

  /** Exclusão transacional — group_members e invites vão junto via ON DELETE CASCADE. */
  async deleteGroup(groupId: string): Promise<void> {
    const rs = await this.db.execute({ sql: "DELETE FROM groups WHERE id = ?", args: [groupId] });
    if (rs.rowsAffected === 0) throw new NotFoundError("Grupo não encontrado.");
  }

  /** Dono não pode saír sem transferir a posse ou excluir o grupo primeiro (issue #33). */
  async leaveGroup(groupId: string, userId: string): Promise<void> {
    const role = await this.getRole(groupId, userId);
    if (!role) throw new NotFoundError("Grupo não encontrado.");
    if (role === "owner") {
      throw new ConflictError("Proprietário não pode saír sem transferir ou excluir o grupo.");
    }
    await this.db.execute({ sql: "DELETE FROM group_members WHERE group_id = ? AND user_id = ?", args: [groupId, userId] });
  }

  async createInvite(groupId: string, createdBy: string, expiresInMinutes: number, maxUses: number): Promise<Invite> {
    const id = newInviteId();
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    await this.db.execute({
      sql: "INSERT INTO invites (id, group_id, token, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, groupId, token, createdBy, expiresAt, maxUses],
    });
    return { id, token, groupId, expiresAt, maxUses, usedCount: 0 };
  }

  /** Só convites não expirados, não revogados e ainda com uso disponível. */
  async listActiveInvites(groupId: string): Promise<Invite[]> {
    const rs = await this.db.execute({
      sql: `SELECT id, token, group_id, expires_at, max_uses, used_count
            FROM invites
            WHERE group_id = ? AND revoked_at IS NULL AND expires_at > ? AND used_count < max_uses
            ORDER BY created_at DESC`,
      args: [groupId, nowIso()],
    });
    const rows = rs.rows as unknown as Pick<InviteRow, "id" | "token" | "group_id" | "expires_at" | "max_uses" | "used_count">[];
    return rows.map(toInvite);
  }

  async revokeInvite(groupId: string, inviteId: string): Promise<void> {
    const rs = await this.db.execute({
      sql: "UPDATE invites SET revoked_at = ? WHERE id = ? AND group_id = ? AND revoked_at IS NULL",
      args: [nowIso(), inviteId, groupId],
    });
    if (rs.rowsAffected === 0) throw new NotFoundError("Convite não encontrado.");
  }

  /**
   * Idempotente para o mesmo usuário: se ele já é membro, devolve o grupo
   * sem incrementar used_count nem falhar, mesmo que o convite já tenha
   * sido usado ao limite por outras pessoas (issue #34).
   *
   * Transação interativa (issue #82) — tem decisão condicional (usuário já
   * é membro? convite esgotado?) entre leituras e escritas, não dá pra
   * expressar como `batch` fixo.
   */
  async acceptInvite(token: string, userId: string): Promise<Group> {
    const tx = await this.db.transaction("write");
    try {
      const inviteRs = await tx.execute({ sql: "SELECT * FROM invites WHERE token = ?", args: [token] });
      const invite = inviteRs.rows[0] as unknown as InviteRow | undefined;
      if (!invite || invite.revoked_at || invite.expires_at <= nowIso()) {
        throw new ConflictError("Convite inválido, expirado ou revogado.");
      }

      const roleRs = await tx.execute({
        sql: "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
        args: [invite.group_id, userId],
      });
      const existingRole = (roleRs.rows[0] as unknown as { role: Role } | undefined)?.role;

      let role: Role;
      if (existingRole) {
        role = existingRole;
      } else {
        if (invite.used_count >= invite.max_uses) {
          throw new ConflictError("Convite esgotado.");
        }
        await tx.execute({
          sql: "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
          args: [invite.group_id, userId],
        });
        await tx.execute({ sql: "UPDATE invites SET used_count = used_count + 1 WHERE id = ?", args: [invite.id] });
        role = "member";
      }

      const groupRs = await tx.execute({ sql: "SELECT id, name, owner_id, created_at FROM groups WHERE id = ?", args: [invite.group_id] });
      const group = groupRs.rows[0] as unknown as GroupRow;

      await tx.commit();
      return { id: group.id, name: group.name, ownerId: group.owner_id, createdAt: group.created_at, role };
    } finally {
      tx.close();
    }
  }
}
