import { getDb } from "../../db/index.ts";
import { newUuid } from "../ids.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { createAdminSession, destroyAllSessionsForUser } from "./session.ts";

const MAX_FAILED_BEFORE_LOCK = 5;
const LOCK_MS = 15 * 60 * 1000;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

export type LoginResult =
  | { ok: true; token: string; csrfToken: string }
  | { ok: false; error: "INVALID" | "LOCKED"; retryAfterSeconds?: number };

function recentFailures(username: string, ip: string | null): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE attempted_at > ? AND successful = 0 AND (username = ? OR (? IS NOT NULL AND ip = ?))`
    )
    .get(Date.now() - THROTTLE_WINDOW_MS, username.toLowerCase(), ip, ip) as unknown as
    | { c: number }
    | undefined;
  return row?.c ?? 0;
}

export function attemptLogin(input: {
  username: unknown;
  password: unknown;
  ip: string | null;
  userAgent: string | null;
}): LoginResult {
  const db = getDb();
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!username || !password || password.length > 1024) {
    recordAttempt(username, input.ip, false);
    return { ok: false, error: "INVALID" };
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        failed_attempts: number;
        locked_until: number | null;
      }
    | undefined;

  const now = Date.now();

  // Progressive throttle: banyak kegagalan baru-baru ini dari user/IP yang sama
  // memperlambat respons tanpa membocorkan status akun.
  const failures = recentFailures(user?.username ?? username, input.ip);
  if (failures >= 10) {
    busySleep(Math.min(2000, failures * 100));
  }

  if (user && user.locked_until && user.locked_until > now) {
    return {
      ok: false,
      error: "LOCKED",
      retryAfterSeconds: Math.ceil((user.locked_until - now) / 1000),
    };
  }

  const valid = !!user && verifyPassword(password, user.password_hash);
  recordAttempt(username, input.ip, valid);

  if (!user || !valid) {
    if (user) {
      const nextFails = user.failed_attempts + 1;
      db.prepare(
        "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?"
      ).run(
        nextFails,
        nextFails >= MAX_FAILED_BEFORE_LOCK ? now + LOCK_MS : null,
        now,
        user.id
      );
    }
    return { ok: false, error: "INVALID" };
  }

  db.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, user.id);

  const { token, csrfToken } = createAdminSession(user.id, input.ip, input.userAgent);
  return { ok: true, token, csrfToken };
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as unknown as { c: number };
  return row.c;
}

/** Buat / reset password user admin (dipakai seed & admin CRUD). */
export function upsertUser(opts: {
  username: string;
  password?: string;
  passwordHash?: string;
  role: "admin" | "viewer";
}): { id: string; created: boolean } {
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(opts.username) as
    | { id: string }
    | undefined;
  const hash = opts.passwordHash ?? hashPassword(opts.password!);
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, role = ?, updated_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(
      hash,
      opts.role,
      now,
      existing.id
    );
    destroyAllSessionsForUser(existing.id);
    return { id: existing.id, created: false };
  }
  const id = newUuid();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, opts.username, hash, opts.role, now, now);
  return { id, created: true };
}

function recordAttempt(username: string, ip: string | null, successful: boolean): void {
  getDb()
    .prepare("INSERT INTO login_attempts (username, ip, successful, attempted_at) VALUES (?, ?, ?, ?)")
    .run(username.toLowerCase(), ip, successful ? 1 : 0, Date.now());
}

function busySleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* intentional delay untuk throttle brute force */
  }
}
