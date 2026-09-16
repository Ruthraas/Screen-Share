import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hash de senha com scrypt (built-in do Node — issue #30 pede algoritmo
 * lento e salgado; scrypt evita adicionar uma dependência nativa nova bem
 * depois de resolver a dor de instalação nativa do better-sqlite3 no
 * #58). `pepper` vem da config (`PASSWORD_PEPPER`), nunca do banco —
 * mesmo se o banco vazar, a senha não é quebrável só com o hash.
 *
 * Formato armazenado: "scrypt:<salt hex>:<hash hex>".
 */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password + pepper, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, pepper: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scryptAsync(password + pepper, salt, expected.length)) as Buffer;

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
