import crypto from "node:crypto";
import { getDb } from "../db/index.ts";
import { getEnv } from "./env.ts";

/**
 * Akses tabel settings dengan typed JSON + fallback urutan:
 *   nilai admin (settings) > env > default.
 * Secret yang tidak disediakan env dibuat sekali dan dipersist di DB
 * agar sesi tetap valid lintas restart tanpa menyimpan plaintext di file terpisah.
 */

export function getSetting<T>(key: string): T | undefined {
  const row = getDb().prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return undefined;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), Date.now());
}

export function listSettings(): Array<{ key: string; value_json: string; updated_at: number }> {
  return getDb().prepare("SELECT key, value_json, updated_at FROM settings ORDER BY key").all() as Array<{
    key: string;
    value_json: string;
    updated_at: number;
  }>;
}

function ensureGeneratedSecret(key: string): string {
  const existing = getSetting<string>(key);
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const generated = crypto.randomBytes(48).toString("base64url");
  setSetting(key, generated);
  return generated;
}

export type SettingSource = "settings" | "env" | "default" | "generated";
export type Effective<T> = { value: T; source: SettingSource };

/** Hapus override dashboard -> kembali ke fallback env/default. */
export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

/**
 * Urutan prioritas untuk SEMUA pengaturan yang bisa diubah dari dashboard:
 *   settings (admin)  >  env (.env, fallback/bootstrap)  >  default.
 */

/** Secret penanda tangan cookie sesi admin. */
export function getSessionSecret(): Effective<string> {
  const s = getSetting<string>("session_secret");
  if (typeof s === "string" && s.length >= 32) return { value: s, source: "settings" };
  const env = process.env.SESSION_SECRET?.trim();
  if (env && env.length >= 32) return { value: env, source: "env" };
  return { value: ensureGeneratedSecret("generated_session_secret"), source: "generated" };
}

/** Shared secret integrasi (Paymenter -> gateway). */
export function getIntegrationSecret(): Effective<string> {
  const s = getSetting<string>("integration_secret");
  if (typeof s === "string" && s.length >= 32) return { value: s, source: "settings" };
  const env = process.env.INTEGRATION_SECRET?.trim();
  if (env && env.length >= 32) return { value: env, source: "env" };
  // Belum ada sumber mana pun: generate supaya sistem tetap aman-by-default.
  return { value: ensureGeneratedSecret("generated_integration_secret"), source: "generated" };
}

export function hasExplicitIntegrationSecret(): boolean {
  return getIntegrationSecret().source !== "generated";
}

/** Konfigurasi provider yang bisa dioverride dari dashboard Settings. */
export function getConfiguredQrisStatic(): Effective<string> {
  const s = getSetting<string>("qris_static");
  if (typeof s === "string" && s.trim()) return { value: s.trim(), source: "settings" };
  const env = getEnv().QRIS_STATIC ?? "";
  return env ? { value: env, source: "env" } : { value: "", source: "default" };
}

/**
 * Kanonikalisasi ID merchant GoPay: bentuk resmi dari Gojek berprefix "G"
 * (mis. G566035778). Menerima input "566035778", "g566035778", atau
 * "G566035778" -> selalu "G566035778". Upstream menolak (403 unauthorized
 * merchant access) bila prefix hilang.
 */
export function normalizeGoPayMerchantId(raw: string): string {
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (/^G?[0-9]{4,19}$/.test(v)) return v.startsWith("G") ? v : `G${v}`;
  return raw.trim();
}

export function getConfiguredMerchantId(): Effective<string> {
  const s = getSetting<string>("gopay_merchant_id");
  if (typeof s === "string" && s.trim()) return { value: normalizeGoPayMerchantId(s), source: "settings" };
  const env = getEnv().GOPAY_MERCHANT_ID ?? "";
  return env ? { value: normalizeGoPayMerchantId(env), source: "env" } : { value: "", source: "default" };
}

export function effectiveAppUrl(): Effective<string> {
  const s = getSetting<string>("app_url");
  if (typeof s === "string" && s.trim()) return { value: s.trim().replace(/\/+$/, ""), source: "settings" };
  return { value: getEnv().APP_URL.replace(/\/+$/, ""), source: process.env.APP_URL ? "env" : "default" };
}

type NumberBounds = { min: number; max: number; def: number };
type NumericEnvKey =
  | "PAYMENT_TTL_SECONDS"
  | "CALLBACK_TIMEOUT_MS"
  | "MONITOR_POLL_INTERVAL_MS"
  | "MONITOR_VIEWER_LEASE_MS"
  | "MONITOR_TICK_MS";

function effectiveNumber(key: string, envName: NumericEnvKey, b: NumberBounds): Effective<number> {
  const raw = getSetting<unknown>(key);
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= b.min && n <= b.max) return { value: Math.trunc(n), source: "settings" };
  const envVal = getEnv()[envName];
  if (process.env[envName] !== undefined) return { value: envVal, source: "env" };
  return { value: envVal, source: "default" }; // env sudah berisi default zod
}

export function effectivePaymentTtlSeconds(): Effective<number> {
  return effectiveNumber("payment_ttl_seconds", "PAYMENT_TTL_SECONDS", { min: 30, max: 86400, def: 300 });
}
export function effectiveCallbackTimeoutMs(): Effective<number> {
  return effectiveNumber("callback_timeout_ms", "CALLBACK_TIMEOUT_MS", { min: 1000, max: 60000, def: 10000 });
}
export function effectiveMonitorPollIntervalMs(): Effective<number> {
  return effectiveNumber("monitor_poll_interval_ms", "MONITOR_POLL_INTERVAL_MS", { min: 4000, max: 300000, def: 8000 });
}
export function effectiveMonitorViewerLeaseMs(): Effective<number> {
  return effectiveNumber("monitor_viewer_lease_ms", "MONITOR_VIEWER_LEASE_MS", { min: 8000, max: 120000, def: 25000 });
}
export function effectiveMonitorTickMs(): Effective<number> {
  return effectiveNumber("monitor_tick_ms", "MONITOR_TICK_MS", { min: 1000, max: 60000, def: 4000 });
}
