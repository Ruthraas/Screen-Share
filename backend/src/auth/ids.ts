import { randomUUID } from "node:crypto";

export function newUserId(): string {
  return `usr_${randomUUID()}`;
}

export function newOAuthAccountId(): string {
  return `oac_${randomUUID()}`;
}

export function newRefreshTokenId(): string {
  return `rft_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
