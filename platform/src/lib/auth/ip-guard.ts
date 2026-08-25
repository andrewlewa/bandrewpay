/**
 * Pemblokiran IP untuk permukaan login admin.
 *
 * - Blokir otomatis PERMANEN: >= THRESHOLD kegagalan login berturut-turut
 *   (sejak login sukses terakhir dari IP tersebut, dihitung dari tabel
 *   `login_attempts`) -> IP diblokir tanpa batas waktu.
 * - Blokir manual: admin menambah/menghapus lewat Admin > Keamanan
 *   (`expires_at` NULL = permanen).
 *
 * Pemberlakuan: GET /admin/login (halaman) + POST /api/admin/login (+ endpoint form).
 */

import { getDb } from "../../db/index.ts";
import { logAudit } from "../audit.ts";

export const LOGIN_IP_FAIL_THRESHOLD = 3;

export type IpBlock = {
  ip: string;
  reason: string;
  blocked_at: number;
  expires_at: number | null;
};

/** Cek apakah IP sedang diblokir (blokir kedaluwarsa otomatis diabaikan). */
export function isIpBlocked(ip: string | null, nowMs = Date.now()): IpBlock | null {
  if (!ip) return null;
  const row = getDb()
    .prepare("SELECT ip, reason, blocked_at, expires_at FROM ip_blocks WHERE ip = ?")
    .get(ip) as IpBlock | undefined;
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= nowMs) return null; // sudah habis masa blokir
  return row;
}

/** Jumlah kegagalan login berturut-turut dari satu IP (reset saat ada sukses). */
export function countConsecutiveFailures(ip: string | null): number {
  if (!ip) return 0;
  const { c } = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE ip = ? AND successful = 0
         AND id > COALESCE((SELECT MAX(id) FROM login_attempts WHERE ip = ? AND successful = 1), 0)`
    )
    .get(ip, ip) as unknown as { c: number };
  return c;
}

/**
 * Setelah kegagalan login, bila jumlah kegagalan berturut-turut mencapai
 * threshold -> blokir IP SECARA PERMANEN. Mengembalikan blokir baru bila dibuat.
 */
export function autoBlockIfAbusive(ip: string | null, actor = "system", nowMs = Date.now()): IpBlock | null {
  if (!ip || isIpBlocked(ip, nowMs)) return null;
  const failures = countConsecutiveFailures(ip);
  if (failures < LOGIN_IP_FAIL_THRESHOLD) return null;

  const block: IpBlock = {
    ip,
    reason: `auto: ${failures}x gagal login — blokir permanen`,
    blocked_at: nowMs,
    expires_at: null,
  };
  upsertBlock(block);
  logAudit({ actor, action: "security.ip.autoblock", entityType: "ip_block", entityId: ip });
  console.warn(`[security] IP ${ip} diblokir PERMANEN (${block.reason})`);
  return block;
}

export function upsertBlock(block: IpBlock): void {
  getDb()
    .prepare(
      `INSERT INTO ip_blocks (ip, reason, blocked_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason,
         blocked_at = excluded.blocked_at, expires_at = excluded.expires_at`
    )
    .run(block.ip, block.reason, block.blocked_at, block.expires_at);
}

export function listBlocks(): IpBlock[] {
  return getDb()
    .prepare("SELECT ip, reason, blocked_at, expires_at FROM ip_blocks ORDER BY blocked_at DESC LIMIT 200")
    .all() as IpBlock[];
}

export function unblockIp(ip: string): boolean {
  const res = getDb().prepare("DELETE FROM ip_blocks WHERE ip = ?").run(ip);
  return res.changes > 0;
}

export function isValidIp(raw: string): boolean {
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(raw) ||
    /^[0-9a-fA-F:]{2,45}$/.test(raw); // IPv6 longgar
}
