import type Database from "better-sqlite3";
import type { Role } from "../authz/policy.js";
import { ConflictError, NotFoundError } from "./errors.js";
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
 */
export class GroupsRepository {
  constructor(private readonly db: Database.Database) {}

  getRole(groupId: string, userId: string): Role | undefined {
    const row = this.db
      .prepare("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?")
      .get(groupId, userId) as { role: Role } | undefined;
    return row?.role;
  }

  createGroup(name: string, ownerId: string): Group {
    const id = newGroupId();
    const createdAt = nowIso();
    const run = this.db.transaction(() => {
      this.db.prepare("INSERT INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)").run(id, name, ownerId, createdAt);
      this.db
        .prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .run(id, ownerId, createdAt);
    });
    run();
    return { id, name, ownerId, role: "owner", createdAt };
  }

  listGroupsForUser(userId: string): Group[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.name, g.owner_id, g.created_at, m.role
         FROM groups g
         JOIN group_members m ON m.group_id = g.id
         WHERE m.user_id = ?
         ORDER BY g.created_at ASC`,
      )
      .all(userId) as (GroupRow & { role: Role })[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      role: row.role,
    }));
  }

  /** undefined se o grupo não existe OU o usuário não é membro — o chamador decide como responder (ver authz/policy.ts). */
  getGroupForUser(groupId: string, userId: string): GroupDetail | undefined {
    const role = this.getRole(groupId, userId);
    if (!role) return undefined;

    const group = this.db.prepare("SELECT id, name, owner_id, created_at FROM groups WHERE id = ?").get(groupId) as
      | GroupRow
      | undefined;
    if (!group) return undefined;

    const members = this.db
      .prepare("SELECT user_id, role FROM group_members WHERE group_id = ? ORDER BY joined_at ASC")
      .all(groupId) as { user_id: string; role: Role }[];

    return {
      id: group.id,
      name: group.name,
      ownerId: group.owner_id,
      createdAt: group.created_at,
      role,
      members: members.map((m) => ({ userId: m.user_id, role: m.role })),
    };
  }

  updateGroupName(groupId: string, name: string): void {
    const result = this.db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, groupId);
    if (result.changes === 0) throw new NotFoundError("Grupo não encontrado.");
  }

  /** Exclusão transacional — group_members e invites vão junto via ON DELETE CASCADE. */
  deleteGroup(groupId: string): void {
    const result = this.db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
    if (result.changes === 0) throw new NotFoundError("Grupo não encontrado.");
  }

  /** Dono não pode saír sem transferir a posse ou excluir o grupo primeiro (issue #33). */
  leaveGroup(groupId: string, userId: string): void {
    const role = this.getRole(groupId, userId);
    if (!role) throw new NotFoundError("Grupo não encontrado.");
    if (role === "owner") {
      throw new ConflictError("Proprietário não pode saír sem transferir ou excluir o grupo.");
    }
    this.db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(groupId, userId);
  }

  createInvite(groupId: string, createdBy: string, expiresInMinutes: number, maxUses: number): Invite {
    const id = newInviteId();
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();
    this.db
      .prepare("INSERT INTO invites (id, group_id, token, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, groupId, token, createdBy, expiresAt, maxUses);
    return { id, token, groupId, expiresAt, maxUses, usedCount: 0 };
  }

  /** Só convites não expirados, não revogados e ainda com uso disponível. */
  listActiveInvites(groupId: string): Invite[] {
    const rows = this.db
      .prepare(
        `SELECT id, token, group_id, expires_at, max_uses, used_count
         FROM invites
         WHERE group_id = ? AND revoked_at IS NULL AND expires_at > ? AND used_count < max_uses
         ORDER BY created_at DESC`,
      )
      .all(groupId, nowIso()) as Pick<InviteRow, "id" | "token" | "group_id" | "expires_at" | "max_uses" | "used_count">[];
    return rows.map(toInvite);
  }

  revokeInvite(groupId: string, inviteId: string): void {
    const result = this.db
      .prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND group_id = ? AND revoked_at IS NULL")
      .run(nowIso(), inviteId, groupId);
    if (result.changes === 0) throw new NotFoundError("Convite não encontrado.");
  }

  /**
   * Idempotente para o mesmo usuário: se ele já é membro, devolve o grupo
   * sem incrementar used_count nem falhar, mesmo que o convite já tenha
   * sido usado ao limite por outras pessoas (issue #34).
   */
  acceptInvite(token: string, userId: string): Group {
    const run = this.db.transaction((): Group => {
      const invite = this.db.prepare("SELECT * FROM invites WHERE token = ?").get(token) as InviteRow | undefined;
      if (!invite || invite.revoked_at || invite.expires_at <= nowIso()) {
        throw new ConflictError("Convite inválido, expirado ou revogado.");
      }

      const existingRole = this.getRole(invite.group_id, userId);
      let role: Role;
      if (existingRole) {
        role = existingRole;
      } else {
        if (invite.used_count >= invite.max_uses) {
          throw new ConflictError("Convite esgotado.");
        }
        this.db
          .prepare("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')")
          .run(invite.group_id, userId);
        this.db.prepare("UPDATE invites SET used_count = used_count + 1 WHERE id = ?").run(invite.id);
        role = "member";
      }

      const group = this.db
        .prepare("SELECT id, name, owner_id, created_at FROM groups WHERE id = ?")
        .get(invite.group_id) as GroupRow;
      return { id: group.id, name: group.name, ownerId: group.owner_id, createdAt: group.created_at, role };
    });
    return run();
  }
}
