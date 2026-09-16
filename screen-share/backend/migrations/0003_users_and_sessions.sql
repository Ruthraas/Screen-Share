-- up
-- Substitui o Firebase Auth como fonte de identidade (issue #30). password_hash
-- é nulo pra conta que só usa OAuth (nunca cadastrou senha própria).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Um usuário pode ter várias contas de provedor vinculadas (ex.: Google e
-- GitHub), mas cada (provider, provider_account_id) só liga a um usuário.
CREATE TABLE oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'discord')),
  provider_account_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts (user_id);

-- Refresh tokens são opacos no cliente; só o hash fica no banco (mesma
-- lógica de nunca guardar segredo em texto puro que já vale pra senha).
-- Revogação é lógica (revoked_at), pra manter histórico de sessão.
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);

-- down
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS oauth_accounts;
DROP TABLE IF EXISTS users;
