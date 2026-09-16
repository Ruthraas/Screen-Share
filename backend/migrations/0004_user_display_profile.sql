-- up
-- Nome/avatar do provedor OAuth (issue #70) — nulos pra conta só-senha
-- (essa já cai pro e-mail como nome do lado do frontend, não muda aqui).
-- Fica em `users`, não em `oauth_accounts`: um usuário só tem um nome de
-- exibição por vez, e a regra é simples — o provedor usado no último
-- login/vínculo vence (sobrescrito a cada findOrCreateOAuthUser).
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- down
ALTER TABLE users DROP COLUMN avatar_url;
ALTER TABLE users DROP COLUMN display_name;
