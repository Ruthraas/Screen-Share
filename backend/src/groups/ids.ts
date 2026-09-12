import { randomUUID, randomBytes } from "node:crypto";

export function newGroupId(): string {
  return `grp_${randomUUID()}`;
}

export function newInviteId(): string {
  return `inv_${randomUUID()}`;
}

/** Token opaco e aleatório com entropia criptográfica (issue #34). */
export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function nowIso(): string {
  return new Date().toISOString();
}
