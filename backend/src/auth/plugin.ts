import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { errorBody } from "../http/errors.js";
import { TokenVerificationError, type AuthIdentity, type TokenVerifier } from "./verifier.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthIdentity;
  }
}

export interface AuthPluginOptions {
  verifier: TokenVerifier;
  /** Caminhos exatos que não exigem token (ex.: "/health"). */
  publicPaths?: string[];
  /** Prefixos que não exigem token (ex.: "/v1/auth/" — cobre rotas dinâmicas como /v1/auth/oauth/:provider/start). */
  publicPrefixes?: string[];
}

/**
 * Middleware de autenticação (issue #30): toda requisição precisa de
 * `Authorization: Bearer <token>` válido, exceto os caminhos em
 * `publicPaths`. Em caso de token ausente/inválido/expirado, responde 401
 * com o envelope de erro padrão — nunca deixa a rota original rodar.
 */
export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const publicPaths = new Set(opts.publicPaths ?? []);
  const publicPrefixes = opts.publicPrefixes ?? [];

  app.decorateRequest("auth", undefined);

  app.addHook("onRequest", async (request, reply) => {
    // request.url inclui a query string (ex.: "/ws?token=...&groupId=...")
    // — comparar só o pathname, senão nenhuma rota com query bate no Set.
    const pathname = request.url.split("?")[0];
    if (publicPaths.has(pathname) || publicPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      return;
    }

    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;

    if (!token) {
      await reply.code(401).send(errorBody("unauthorized", "Token ausente ou inválido.", request.id));
      return reply;
    }

    try {
      request.auth = await opts.verifier.verify(token);
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        await reply.code(401).send(errorBody("unauthorized", "Token ausente ou inválido.", request.id));
        return reply;
      }
      throw err;
    }
  });
};

export default fp(authPlugin, { name: "auth-plugin" });
