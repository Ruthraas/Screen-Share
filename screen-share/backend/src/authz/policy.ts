import { ForbiddenError, NotFoundError } from "../errors.js";

export type Role = "owner" | "admin" | "member";

/**
 * Policy única de autorização (issue #35) — usada por toda rota HTTP e,
 * mais adiante, também pelo signaling (#39). Nunca duplicar esta lógica
 * em handlers individuais.
 *
 * Matriz de permissões:
 *
 * | Ação                          | owner | admin | member |
 * |-------------------------------|-------|-------|--------|
 * | ver grupo / listar membros    |  sim  |  sim  |  sim   |
 * | atualizar nome do grupo       |  sim  |  sim  |  não   |
 * | criar/revogar convite         |  sim  |  sim  |  não   |
 * | sair do grupo                 |  não* |  sim  |  sim   |
 * | excluir o grupo               |  sim  |  não  |  não   |
 *
 * *owner só sai depois de transferir a posse ou excluir o grupo (issue #33).
 */
export interface MembershipLookup {
  getRole(groupId: string, userId: string): Promise<Role | undefined>;
}

/**
 * Confirma que o usuário é membro do grupo e devolve seu papel. Grupo
 * inexistente e "você não é membro" respondem o mesmo NotFoundError —
 * por padrão, acesso é negado e a existência do grupo não é revelada a
 * quem não participa dele.
 *
 * Assíncrona desde a issue #82 (`getRole` passou a bater num banco remoto).
 */
export async function requireMembership(repo: MembershipLookup, groupId: string, userId: string): Promise<Role> {
  const role = await repo.getRole(groupId, userId);
  if (!role) {
    throw new NotFoundError("Grupo não encontrado.");
  }
  return role;
}

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) {
    throw new ForbiddenError("Você não tem permissão para esta ação.");
  }
}
