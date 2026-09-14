import type Database from "better-sqlite3";
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

/**
 * Acesso a dados de usuários/contas OAuth/refresh tokens (issue #30).
 * Autorização e política de senha/token ficam fora daqui — este módulo só
 * executa o que já foi decidido pelo chamador (routes/auth.ts).
 */
export class UserRepository {
  constructor(private readonly db: Database.Database) {}

  findByEmail(email: string): (UserRecord & { passwordHash: string | null }) | undefined {
    const row = this.db
      .prepare("SELECT id, email, password_hash, display_name, avatar_url FROM users WHERE email = ?")
      .get(email) as UserRow | undefined;
    if (!row) return undefined;
    return { id: row.id, email: row.email, passwordHash: row.password_hash, displayName: row.display_name, avatarUrl: row.avatar_url };
  }

  findById(id: string): UserRecord | undefined {
    const row = this.db.prepare("SELECT id, email, display_name, avatar_url FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url } : undefined;
  }

  createWithPassword(email: string, passwordHash: string): UserRecord {
    const existing = this.findByEmail(email);
    if (existing) throw new ConflictError("Este e-mail já está cadastrado.");

    const id = newUserId();
    this.db
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, email, passwordHash, nowIso());
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
   */
  findOrCreateOAuthUser(
    provider: OAuthProviderName,
    providerAccountId: string,
    email: string | undefined,
    profile: { displayName?: string; avatarUrl?: string } = {},
  ): UserRecord {
    const run = this.db.transaction((): UserRecord => {
      const existingLink = this.db
        .prepare("SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?")
        .get(provider, providerAccountId) as { user_id: string } | undefined;

      let user: UserRecord;
      if (existingLink) {
        user = this.findById(existingLink.user_id)!;
      } else {
        const existingUser = email ? this.findByEmail(email) : undefined;
        if (existingUser) {
          user = existingUser;
        } else {
          const id = newUserId();
          this.db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(id, email ?? null, nowIso());
          user = { id, email: email ?? null, displayName: null, avatarUrl: null };
        }
      }

      this.db
        .prepare("UPDATE users SET display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?")
        .run(profile.displayName ?? null, profile.avatarUrl ?? null, user.id);
      user = this.findById(user.id)!;

      if (existingLink) return user;

      this.db
        .prepare("INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(newOAuthAccountId(), user.id, provider, providerAccountId, nowIso());
      return user;
    });
    return run();
  }

  createRefreshToken(userId: string, tokenHash: string, expiresAt: string): void {
    this.db
      .prepare("INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
      .run(newRefreshTokenId(), userId, tokenHash, expiresAt);
  }

  /** undefined se o hash não existe, já expirou ou já foi revogado. */
  findActiveRefreshToken(tokenHash: string): { id: string; userId: string } | undefined {
    const row = this.db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?").get(tokenHash) as
      | RefreshTokenRow
      | undefined;
    if (!row || row.revoked_at || row.expires_at <= nowIso()) return undefined;
    return { id: row.id, userId: row.user_id };
  }

  revokeRefreshToken(id: string): void {
    this.db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), id);
  }
}
