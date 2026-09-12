import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMembership, requireRole } from "../authz/policy.js";
import { ValidationError } from "../errors.js";
import type { GroupsRepository } from "../groups/repository.js";

const createGroupSchema = z.object({ name: z.string().min(1).max(80) });
const updateGroupSchema = z.object({ name: z.string().min(1).max(80) });
const createInviteSchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(10_080).default(1440),
  maxUses: z.number().int().min(1).max(100).default(1),
});

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return result.data;
}

function requireAuth(request: { auth?: { uid: string } }): string {
  // O plugin de auth (#30) já garante isto antes do handler rodar; é só defesa extra de tipo.
  if (!request.auth) throw new Error("request.auth ausente — auth plugin não rodou");
  return request.auth.uid;
}

export function registerGroupRoutes(app: FastifyInstance, repo: GroupsRepository): void {
  app.post("/v1/groups", async (request, reply) => {
    const userId = requireAuth(request);
    const body = parseOrThrow(createGroupSchema, request.body);
    const group = repo.createGroup(body.name, userId);
    reply.code(201);
    return group;
  });

  app.get("/v1/groups", async (request) => {
    const userId = requireAuth(request);
    return { groups: repo.listGroupsForUser(userId) };
  });

  app.get<{ Params: { groupId: string } }>("/v1/groups/:groupId", async (request) => {
    const userId = requireAuth(request);
    requireMembership(repo, request.params.groupId, userId);
    return repo.getGroupForUser(request.params.groupId, userId);
  });

  app.patch<{ Params: { groupId: string } }>("/v1/groups/:groupId", async (request) => {
    const userId = requireAuth(request);
    const role = requireMembership(repo, request.params.groupId, userId);
    requireRole(role, ["owner", "admin"]);
    const body = parseOrThrow(updateGroupSchema, request.body);
    repo.updateGroupName(request.params.groupId, body.name);
    return repo.getGroupForUser(request.params.groupId, userId);
  });

  app.delete<{ Params: { groupId: string } }>("/v1/groups/:groupId", async (request, reply) => {
    const userId = requireAuth(request);
    const role = requireMembership(repo, request.params.groupId, userId);
    requireRole(role, ["owner"]);
    repo.deleteGroup(request.params.groupId);
    reply.code(204);
  });

  app.post<{ Params: { groupId: string } }>("/v1/groups/:groupId/leave", async (request, reply) => {
    const userId = requireAuth(request);
    requireMembership(repo, request.params.groupId, userId);
    repo.leaveGroup(request.params.groupId, userId);
    reply.code(204);
  });

  app.post<{ Params: { groupId: string } }>("/v1/groups/:groupId/invites", async (request, reply) => {
    const userId = requireAuth(request);
    const role = requireMembership(repo, request.params.groupId, userId);
    requireRole(role, ["owner", "admin"]);
    const body = parseOrThrow(createInviteSchema, request.body);
    const invite = repo.createInvite(request.params.groupId, userId, body.expiresInMinutes, body.maxUses);
    reply.code(201);
    return invite;
  });

  app.get<{ Params: { groupId: string } }>("/v1/groups/:groupId/invites", async (request) => {
    const userId = requireAuth(request);
    const role = requireMembership(repo, request.params.groupId, userId);
    requireRole(role, ["owner", "admin"]);
    return { invites: repo.listActiveInvites(request.params.groupId) };
  });

  app.delete<{ Params: { groupId: string; inviteId: string } }>(
    "/v1/groups/:groupId/invites/:inviteId",
    async (request, reply) => {
      const userId = requireAuth(request);
      const role = requireMembership(repo, request.params.groupId, userId);
      requireRole(role, ["owner", "admin"]);
      repo.revokeInvite(request.params.groupId, request.params.inviteId);
      reply.code(204);
    },
  );

  app.post<{ Params: { token: string } }>("/v1/invites/:token/accept", async (request) => {
    const userId = requireAuth(request);
    return repo.acceptInvite(request.params.token, userId);
  });
}
