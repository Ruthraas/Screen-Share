import type { Client } from "@libsql/client";
import { ConflictError } from "../errors.js";
import { newUserId, newOAuthAccountId, newRefreshTokenId, nowIso } from "./ids.js";
import type { OAuthProviderName } from "./oauthProviders.js";

export interface UserRecord {
  id: string;
  email: string | null;
  /** Nome/avatar do provedor OAuth usado no último login/vínculo (issue #70) — null pra conta só-senha. */
  displayName: string | null;
  avatarUrl: string | null;
}

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

function toUserRecord(row: Pick<UserRow, "id" | "email" | "display_name" | "avatar_url">): UserRecord {
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
}

/**
 * Acesso a dados de usuários/contas OAuth/refresh tokens (issue #30).
 * Autorização e política de senha/token ficam fora daqui — este módulo só
 * executa o que já foi decidido pelo chamador (routes/auth.ts).
 *
 * Issue #82: migrado de `better-sqlite3` (síncrono) pra Turso/libSQL
 * (assíncrono, cliente de rede) — todo método agora devolve Promise.
 */
export class UserRepository {
  constructor(private readonly db: Client) {}

  async findByEmail(email: string): Promise<(UserRecord & { passwordHash: string | null }) | undefined> {
    const rs = await this.db.execute({
      sql: "SELECT id, email, password_hash, display_name, avatar_url FROM users WHERE email = ?",
      args: [email],
    });
    const row = rs.rows[0] as unknown as UserRow | undefined;
    if (!row) return undefined;
    return { ...toUserRecord(row), passwordHash: row.password_hash };
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const rs = await this.db.execute({
      sql: "SELECT id, email, display_name, avatar_url FROM users WHERE id = ?",
      args: [id],
    });
    const row = rs.rows[0] as unknown as UserRow | undefined;
    return row ? toUserRecord(row) : undefined;
  }

  async createWithPassword(email: string, passwordHash: string): Promise<UserRecord> {
    const existing = await this.findByEmail(email);
    if (existing) throw new ConflictError("Este e-mail já está cadastrado.");

    const id = newUserId();
    await this.db.execute({
      sql: "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      args: [id, email, passwordHash, nowIso()],
    });
    return { id, email, displayName: null, avatarUrl: null };
  }

  /**
   * Vincula uma conta OAuth a um usuário: reaproveita se (provider, providerAccountId)
   * já existe; senão vincula a um usuário existente com o mesmo e-mail; senão cria
   * um usuário novo (sem senha). Idempotente para o mesmo provider+conta.
   *
   * `profile` (issue #70) atualiza nome/avatar a cada login — "o provedor
   * usado por último vence" (regra simples, registrada em
   * docs/backend/ARQUITETURA.md): `COALESCE` só sobrescreve quando o
   * provedor de fato devolveu um valor desta vez, nunca apaga um nome/
   * avatar bom por causa de uma resposta incompleta pontual.
   *
   * Transação interativa (issue #82: libSQL não tem o equivalente síncrono
   * de `better-sqlite3`'s `db.transaction()` — cada leitura/escrita usa o
   * objeto `tx`, nunca `this.db`, senão não veria as próprias escritas
   * ainda não commitadas dentro da mesma transação).
   */
  async findOrCreateOAuthUser(
    provider: OAuthProviderName,
    providerAccountId: string,
    email: string | undefined,
    profile: { displayName?: string; avatarUrl?: string } = {},
  ): Promise<UserRecord> {
    const tx = await this.db.transaction("write");
    try {
      const linkRs = await tx.execute({
        sql: "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?",
        args: [provider, providerAccountId],
      });
      const existingLink = linkRs.rows[0] as unknown as { user_id: string } | undefined;

      let userId: string;
      if (existingLink) {
        userId = existingLink.user_id;
      } else {
        const existingUserRs = email
          ? await tx.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] })
          : undefined;
        const existingUser = existingUserRs?.rows[0] as unknown as { id: string } | undefined;
        if (existingUser) {
          userId = existingUser.id;
        } else {
          userId = newUserId();
          await tx.execute({
            sql: "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
            args: [userId, email ?? null, nowIso()],
          });
        }
      }

      await tx.execute({
        sql: "UPDATE users SET display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?",
        args: [profile.displayName ?? null, profile.avatarUrl ?? null, userId],
      });

      if (!existingLink) {
        await tx.execute({
          sql: "INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [newOAuthAccountId(), userId, provider, providerAccountId, nowIso()],
        });
      }

      const userRs = await tx.execute({
        sql: "SELECT id, email, display_name, avatar_url FROM users WHERE id = ?",
        args: [userId],
      });
      const userRow = userRs.rows[0] as unknown as UserRow;

      await tx.commit();
      return toUserRecord(userRow);
    } finally {
      tx.close();
    }
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.db.execute({
      sql: "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      args: [newRefreshTokenId(), userId, tokenHash, expiresAt],
    });
  }

  /** undefined se o hash não existe, já expirou ou já foi revogado. */
  async findActiveRefreshToken(tokenHash: string): Promise<{ id: string; userId: string } | undefined> {
    const rs = await this.db.execute({ sql: "SELECT * FROM refresh_tokens WHERE token_hash = ?", args: [tokenHash] });
    const row = rs.rows[0] as unknown as RefreshTokenRow | undefined;
    if (!row || row.revoked_at || row.expires_at <= nowIso()) return undefined;
    return { id: row.id, userId: row.user_id };
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      args: [nowIso(), id],
    });
  }
}
