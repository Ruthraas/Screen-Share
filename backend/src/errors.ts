/** Erros de domínio compartilhados por todos os módulos — mapeados pro envelope HTTP único em src/server.ts. */

export class NotFoundError extends Error {
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Token ausente ou inválido.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class RateLimitedError extends Error {
  constructor(message = "Muitas requisições. Tente novamente mais tarde.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

/** Uma dependência externa (ex.: API de credenciais TURN da Cloudflare) falhou ou está indisponível — nunca culpa de quem chamou. */
export class UpstreamError extends Error {
  constructor(message = "Serviço externo indisponível no momento.") {
    super(message);
    this.name = "UpstreamError";
  }
}
