-- up
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_groups_owner_id ON groups (owner_id);

-- Papel gravado por linha de membresia (owner/admin/member); dono também
-- aparece aqui como membro com role='owner'. Chave primária composta
-- impede membresia duplicada da mesma pessoa no mesmo grupo. Apagar o
-- grupo remove seus membros (ON DELETE CASCADE) — a exclusão do grupo em
-- si (regra de "não existe grupo sem dono") é validada na issue #33.
CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user_id ON group_members (user_id);

-- down
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
