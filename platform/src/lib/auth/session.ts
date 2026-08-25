import { getDb } from "../../db/index.ts";
import { newToken } from "../ids.ts";

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export type AdminSession = {
  id: string;
  user_id: string;
  username: string;
  role: "admin" | "viewer";
  csrf_token: string;
};

export function createAdminSession(userId: string, ip: string | null, userAgent: string | null): {
  token: string;
  csrfToken: string;
} {
  const db = getDb();
  const token = newToken(32);
  const csrfToken = newToken(16);
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, idle_expires_at, absolute_expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(token, userId, csrfToken, now, now + SESSION_IDLE_MS, now + SESSION_ABSOLUTE_MS, now, ip, userAgent);
  return { token, csrfToken };
}

/**
 * Validasi token sesi. Mengembalikan null jika invalid/expired,
 * atau memperbarui jendela idle (sliding) jika valid.
 */
export function getAdminSession(token: string | undefined | null): AdminSession | null {
  if (!token || typeof token !== "string" || token.length < 32) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.csrf_token, s.idle_expires_at, s.absolute_expires_at, s.last_seen_at,
              u.username, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(token) as
    | {
        id: string;
        user_id: string;
        csrf_token: string;
        idle_expires_at: number;
        absolute_expires_at: number;
        last_seen_at: number;
        username: string;
        role: "admin" | "viewer";
      }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  if (now > row.absolute_expires_at || now > row.idle_expires_at) {
    destroyAdminSession(token);
    return null;
  }
  // Sliding idle window (throttle tulisan: maksimal sekali per menit).
  if (now - row.last_seen_at > 60_000) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?").run(
      now,
      now + SESSION_IDLE_MS,
      token
    );
  }
  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    role: row.role,
    csrf_token: row.csrf_token,
  };
}

export function destroyAdminSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

export function destroyAllSessionsForUser(userId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function cleanupExpiredSessions(): void {
  const now = Date.now();
  getDb()
    .prepare("DELETE FROM sessions WHERE absolute_expires_at <= ? OR idle_expires_at <= ?")
    .run(now, now);
}
