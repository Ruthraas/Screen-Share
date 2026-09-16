-- up
-- Token opaco por convite; revogação é lógica (revoked_at) pra manter
-- histórico. used_count/max_uses controla quantas vezes o token pode ser
-- aceito. ON DELETE CASCADE: apagar o grupo apaga seus convites.
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_invites_group_id ON invites (group_id);

-- down
DROP TABLE IF EXISTS invites;
