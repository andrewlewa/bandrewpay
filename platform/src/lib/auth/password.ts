import crypto from "node:crypto";

/**
 * Hash password dengan scrypt (node:crypto, tanpa dependensi eksternal).
 * Format tersimpan: scrypt$N$r$p$<salt-hex>$<hash-hex>
 */
const N = 16384; // 2^14 — OWASP-recommended floor untuk scrypt interaktif
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number.parseInt(parts[1], 10);
    const r = Number.parseInt(parts[2], 10);
    const p = Number.parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    const actual = crypto.scryptSync(password, salt, expected.length, { N: n, r, p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
