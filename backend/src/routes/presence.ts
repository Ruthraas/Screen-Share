import type { FastifyInstance } from "fastify";
import { requireMembership } from "../authz/policy.js";
import type { GroupsRepository } from "../groups/repository.js";
import type { PresenceStore } from "../presence/store.js";

function requireAuth(request: { auth?: { uid: string } }): string {
  if (!request.auth) throw new Error("request.auth ausente — auth plugin não rodou");
  return request.auth.uid;
}

export function registerPresenceRoutes(app: FastifyInstance, repo: GroupsRepository, presence: PresenceStore): void {
  app.post<{ Params: { groupId: string } }>("/v1/groups/:groupId/presence/heartbeat", async (request, reply) => {
    const userId = requireAuth(request);
    requireMembership(repo, request.params.groupId, userId);
    presence.heartbeat(request.params.groupId, userId);
    reply.code(204);
  });

  app.get<{ Params: { groupId: string } }>("/v1/groups/:groupId/presence", async (request) => {
    const userId = requireAuth(request);
    requireMembership(repo, request.params.groupId, userId);
    return { members: presence.list(request.params.groupId) };
  });
}
