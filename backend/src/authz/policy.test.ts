import { test } from "node:test";
import assert from "node:assert/strict";
import { requireMembership, requireRole, type MembershipLookup, type Role } from "./policy.js";
import { ForbiddenError, NotFoundError } from "../groups/errors.js";

function repoWith(role: Role | undefined): MembershipLookup {
  return { getRole: () => role };
}

test("requireMembership lança NotFoundError quando o usuário não é membro", () => {
  assert.throws(() => requireMembership(repoWith(undefined), "g1", "u1"), NotFoundError);
});

test("requireMembership devolve o papel quando o usuário é membro", () => {
  const role = requireMembership(repoWith("admin"), "g1", "u1");
  assert.equal(role, "admin");
});

test("requireRole lança ForbiddenError quando o papel não está na lista permitida", () => {
  assert.throws(() => requireRole("member", ["owner", "admin"]), ForbiddenError);
});

test("requireRole não lança quando o papel está na lista permitida", () => {
  assert.doesNotThrow(() => requireRole("admin", ["owner", "admin"]));
});
