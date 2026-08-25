/**
 * Registry aplikasi integrasi (multi-platform).
 *
 * Setiap platform toko (Paymenter, dll.) didaftarkan sebagai "aplikasi" dengan
 * secret sendiri + default callback/redirect URL. Transaksi yang dibuat dengan
 * header X-BP-Key: <app_id> ditandatangani memakai secret aplikasi tersebut,
 * dan callback-nya pun dikirim dengan secret yang sama.
 *
 * Keamanan:
 * - Secret disimpan plaintext di SQLite (file DB chmod 600, setara proteksi .env)
 *   karena dibutuhkan untuk verifikasi HMAC.
 * - Secret hanya dikembalikan utuh SEKALI (saat buat/rotasi); API list hanya
 *   mengembalikan versi termask.
 */

import crypto from "node:crypto";
import { getDb } from "../db/index.ts";

export const APP_KEY_HEADER = "x-bp-key";

export type IntegrationApp = {
  id: string;
  label: string;
  /** Secret plaintext — JANGAN pernah log/kirim ke klien. */
  secret: string;
  callback_url: string | null;
  redirect_url: string | null;
  active: boolean;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
};

type Row = {
  id: string;
  label: string;
  secret: string;
  callback_url: string | null;
  redirect_url: string | null;
  active: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
};

function fromRow(r: Row): IntegrationApp {
  return { ...r, active: !!r.active };
}

export function isAcceptableHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw || raw.length > 512) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function maskSecret(secret: string): string {
  if (!secret) return "(tidak tersimpan)";
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}${"*".repeat(Math.max(secret.length - 8, 6))}${secret.slice(-4)}`;
}

export function generateAppSecret(): string {
  return crypto.randomBytes(32).toString("base64url"); // ~43 karakter
}

export function newIntegrationApp(input: {
  label: string;
  secret?: string;
  callback_url?: string | null;
  redirect_url?: string | null;
}): { app: IntegrationApp; generatedSecret: string | null } {
  const db = getDb();
  const id = `APP-${crypto.randomBytes(6).toString("hex")}`;
  const now = Date.now();
  const secret = input.secret?.trim() || generateAppSecret();
  db.prepare(
    `INSERT INTO api_credentials (id, label, secret_hash, secret, callback_url, redirect_url, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    input.label.trim(),
    crypto.createHash("sha256").update(secret).digest("hex"),
    secret,
    input.callback_url ?? null,
    input.redirect_url ?? null,
    now,
    now
  );
  const app = getIntegrationApp(id)!;
  // generatedSecret null artinya secret diisi manual oleh admin.
  return { app, generatedSecret: input.secret?.trim() ? null : secret };
}

export function getIntegrationApp(id: string): IntegrationApp | null {
  const row = getDb().prepare("SELECT * FROM api_credentials WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function listIntegrationApps(): IntegrationApp[] {
  return (
    getDb()
      .prepare("SELECT * FROM api_credentials ORDER BY created_at DESC")
      .all() as Row[]
  ).map(fromRow);
}

export function updateIntegrationApp(
  id: string,
  patch: {
    label?: string;
    callback_url?: string | null;
    redirect_url?: string | null;
    active?: boolean;
  }
): IntegrationApp | null {
  const db = getDb();
  const existing = getIntegrationApp(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE api_credentials SET
       label = ?, callback_url = ?, redirect_url = ?, active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.label?.trim() ?? existing.label,
    patch.callback_url !== undefined ? patch.callback_url : existing.callback_url,
    patch.redirect_url !== undefined ? patch.redirect_url : existing.redirect_url,
    patch.active !== undefined ? (patch.active ? 1 : 0) : (existing.active ? 1 : 0),
    Date.now(),
    id
  );
  return getIntegrationApp(id);
}

/** Rotasi secret. Secret baru HANYA ada di nilai kembalian. */
export function rotateIntegrationAppSecret(id: string, newSecret?: string): { app: IntegrationApp; secret: string } | null {
  const db = getDb();
  const existing = getIntegrationApp(id);
  if (!existing) return null;
  const secret = newSecret?.trim() || generateAppSecret();
  db.prepare("UPDATE api_credentials SET secret = ?, secret_hash = ?, updated_at = ? WHERE id = ?")
    .run(secret, crypto.createHash("sha256").update(secret).digest("hex"), Date.now(), id);
  return { app: getIntegrationApp(id)!, secret };
}

export function deleteIntegrationApp(id: string): boolean {
  const res = getDb().prepare("DELETE FROM api_credentials WHERE id = ?").run(id);
  return res.changes > 0;
}

export function touchLastUsed(id: string): void {
  getDb().prepare("UPDATE api_credentials SET last_used_at = ? WHERE id = ?").run(Date.now(), id);
}
