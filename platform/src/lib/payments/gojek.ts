/**
 * Adapter provider GoBiz/GoPay — port setia dari sessionManager.js + transactionsApi.js.
 *
 * Aturan yang dipertahankan (jangan "diperbaiki" tanpa bukti):
 * - expires_at (+24 jam) adalah asumsi hardcoded, bukan dari server upstream.
 * - Header/fingerprint browser disalin apa adanya (reverse-engineered).
 * - 401 -> refresh token -> retry TEPAT SEKALI. Tanpa loop tambahan
 *   (risiko banned akun merchant).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../db/index.ts";
import { getEnv } from "../env.ts";
import { getConfiguredMerchantId } from "../config-store.ts";

export const GOBIZ_TOKEN_URL = "https://api.gobiz.co.id/goid/token";
export const GOJEK_TRANSACTIONS_URL =
  "https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions";

export class MissingSessionError extends Error {
  constructor() {
    super("Sesi GoPay belum ada. Login via dashboard (Admin > Sesi GoPay) atau impor via `npm run import-session`.");
    this.name = "MissingSessionError";
  }
}

export type ProviderSession = {
  phone_number: string | null;
  merchant_id: string | null;
  outlet_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  cookie: string | null;
  updated_at: string;
  expires_at: string | null;
};

function generateUUID(): string {
  return crypto.randomUUID();
}

// --- Penyimpanan sesi di SQLite (menggantikan file plaintext JSON legacy) ---

export function loadSession(): ProviderSession | null {
  const row = getDb().prepare("SELECT data_json FROM provider_session WHERE id = 1").get() as
    | { data_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data_json) as ProviderSession;
  } catch {
    return null;
  }
}

/** Simpan sesi ke DB. JANGAN pernah log isi sesi (berisi bearer token). */
export function saveSession(session: ProviderSession): void {
  getDb()
    .prepare(
      `INSERT INTO provider_session (id, data_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
    )
    .run(JSON.stringify(session), Date.now());
}

/** Impor sekali-arah dari file sesi legacy (read-only; tidak pernah menulis balik). */
export function importSessionFromFile(filePath?: string): { imported: boolean; reason?: string } {
  const target = filePath || getEnv().GOPAY_SESSION_FILE;
  if (!target) return { imported: false, reason: "GOPAY_SESSION_FILE tidak diset" };
  let resolved = target;
  if (!fs.existsSync(resolved)) {
    // fallback path relatif terhadap root repo (di atas folder platform/)
    const alt = path.resolve(process.cwd(), "..", target);
    if (fs.existsSync(alt)) resolved = alt;
    else return { imported: false, reason: `file tidak ditemukan: ${target}` };
  }
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ProviderSession>;
    if (!parsed.access_token && !parsed.refresh_token) {
      return { imported: false, reason: "file tidak berisi token" };
    }
    const existing = loadSession();
    // Jangan turunkan token yang lebih baru di DB dengan file yang lebih tua.
    if (
      existing?.updated_at &&
      parsed.updated_at &&
      new Date(existing.updated_at) > new Date(parsed.updated_at)
    ) {
      return { imported: false, reason: "sesi DB sudah lebih baru dari file" };
    }
    saveSession({
      phone_number: parsed.phone_number ?? null,
      merchant_id: parsed.merchant_id ?? null,
      outlet_name: parsed.outlet_name ?? null,
      access_token: parsed.access_token ?? null,
      refresh_token: parsed.refresh_token ?? null,
      cookie: parsed.cookie ?? null,
      updated_at: parsed.updated_at ?? new Date().toISOString(),
      expires_at: parsed.expires_at ?? null,
    });
    return { imported: true };
  } catch (err) {
    return { imported: false, reason: err instanceof Error ? err.message : "gagal membaca file" };
  }
}

export function isExpired(session: ProviderSession | null): boolean {
  if (!session || !session.access_token) return true;
  if (!session.expires_at) return false;
  const nowMs = Date.now();
  const expiresAtMs = new Date(session.expires_at).getTime();
  return expiresAtMs - nowMs < 300_000; // sisa <5 menit dianggap expired
}

const REFRESH_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "id",
  "authentication-type": "go-id",
  "content-type": "application/json",
  "gojek-country-code": "ID",
  "gojek-timezone": "Asia/Jakarta",
  origin: "https://portal.gofoodmerchant.co.id",
  referer: "https://portal.gofoodmerchant.co.id/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "x-appid": "go-biz-web-dashboard",
  "x-appversion": "platform-v3.111.0-1708bc9a",
  "x-deviceos": "Web",
  "x-phonemake": "Windows 10 64-bit",
  "x-phonemodel": "Chrome 150.0.0.0 on Windows 10 64-bit",
  "x-platform": "Web",
  "x-user-locale": "en-GB",
  "x-user-type": "merchant",
};

/** Refresh token ke GoBiz. Mengembalikan sesi baru atau null jika gagal. */
export async function refreshSession(): Promise<ProviderSession | null> {
  const session = loadSession();
  if (!session?.refresh_token) {
    console.warn("[gojek] Refresh token tidak ditemukan — diperlukan impor/login sesi.");
    return null;
  }

  let localPhoneNumber = (session.phone_number || "").replace(/\D/g, "");
  if (localPhoneNumber.startsWith("62")) {
    localPhoneNumber = localPhoneNumber.slice(2);
  } else if (localPhoneNumber.startsWith("0")) {
    localPhoneNumber = localPhoneNumber.slice(1);
  }

  try {
    const response = await fetch(GOBIZ_TOKEN_URL, {
      method: "POST",
      headers: { ...REFRESH_HEADERS, "x-uniqueid": generateUUID() },
      body: JSON.stringify({
        client_id: "go-biz-web-new",
        grant_type: "refresh_token",
        data: {
          refresh_token: session.refresh_token,
          phone_number: localPhoneNumber,
          country_code: "62",
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`[gojek] Auto-refresh token GAGAL: HTTP ${response.status}`);
      return null;
    }

    const responseBody = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      data?: { access_token?: string; refresh_token?: string };
    };

    const newAccessToken = responseBody.access_token || responseBody.data?.["access_token"];
    const newRefreshToken =
      responseBody.refresh_token || responseBody.data?.["refresh_token"] || session.refresh_token;

    if (!newAccessToken) {
      console.error("[gojek] Respon refresh token tidak berisi access_token valid.");
      return null;
    }

    const cookieString = `access_token=${newAccessToken}; refresh_token=${newRefreshToken}; auth_method=goid`;
    // +24 jam adalah asumsi legacy (bukan nilai server) — dipertahankan.
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const updatedSession: ProviderSession = {
      ...session,
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      cookie: cookieString,
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
    };
    saveSession(updatedSession);
    return updatedSession;
  } catch (err) {
    console.error("[gojek] Auto-refresh token GAGAL:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function getValidHeaders(
  userAgent?: string | null
): Promise<Record<string, string> | null> {
  let session = loadSession();
  if (!session?.access_token) {
    return null;
  }
  if (isExpired(session)) {
    const refreshed = await refreshSession();
    if (refreshed) session = refreshed;
  }
  const accessToken = session.access_token!;
  const cookieString =
    session.cookie ||
    `access_token=${accessToken}; refresh_token=${session.refresh_token ?? ""}; auth_method=goid`;

  return {
    Authorization: `Bearer ${accessToken}`,
    Cookie: cookieString,
    "authentication-type": "go-id",
    Accept: "application/json, text/plain, */*",
    Origin: "https://portal.gofoodmerchant.co.id",
    Referer: "https://portal.gofoodmerchant.co.id/",
    "User-Agent":
      userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
}

// --- Endpoint analytics transaksi ---

export type UpstreamTransactionParams = {
  from: number;
  size: number;
  statuses: string;
  payment_types: string;
  start_time: string;
  end_time: string;
  merchant_ids: string;
};

type FetchResult = {
  status: number;
  json: unknown | null;
};

async function fetchMerchantTransactions(
  headers: Record<string, string>,
  params: UpstreamTransactionParams,
  timeoutMs = 10_000
): Promise<FetchResult> {
  const url = new URL(GOJEK_TRANSACTIONS_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  // Diagnostik opsional (DEBUG_PROVIDER=1): buang bentuk respons upstream ke
  // log TANPA token/cookie — hanya field netral (id/amount/waktu/status).
  if (process.env.DEBUG_PROVIDER === "1") {
    const items = extractDebugItems(json);
    const sample = items.slice(0, 5).map((t: Record<string, unknown>) => ({
      id: t.id ?? t.order_id ?? t.wallstreet_transaction_id,
      gross_amount: t.gross_amount,
      real_gross_amount: t.real_gross_amount,
      amount: t.amount,
      status: t.status,
      transaction_time: t.transaction_time,
      created_at: t.created_at,
      settlement_time: t.settlement_time,
    }));
    console.info(
      `[debug-provider] GET tx -> HTTP ${response.status}; params(from=${params.from},size=${params.size},start=${params.start_time},end=${params.end_time}); items=${items.length}${items.length ? `; keys=${Object.keys(items[0] ?? {}).join("|")}` : ""}\n[debug-provider] sample=${JSON.stringify(sample)}`
    );
  }
  return { status: response.status, json };
}

/** Ekstraksi aman utk debug: sama seperti fallback path verifier. */
function extractDebugItems(json: unknown): Array<Record<string, unknown>> {
  if (!json || typeof json !== "object") return [];
  const obj = json as { data?: unknown; transactions?: unknown };
  if (Array.isArray(obj.data)) return obj.data as Array<Record<string, unknown>>;
  const inner = (obj.data as { transactions?: unknown } | undefined)?.transactions;
  if (Array.isArray(inner)) return inner as Array<Record<string, unknown>>;
  if (Array.isArray(obj.transactions)) return obj.transactions as Array<Record<string, unknown>>;
  return [];
}

export class UpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/**
 * Resolusi header sesi + satu kali recovery 401 (refresh, ulang SEKALI).
 * Port persis dari fetchWithSessionRetry().
 */
export async function fetchWithSessionRetry(
  params: UpstreamTransactionParams,
  opts?: { userAgent?: string | null }
): Promise<unknown> {
  const headers = await getValidHeaders(opts?.userAgent);
  if (!headers) throw new MissingSessionError();

  let result: FetchResult;
  try {
    result = await fetchMerchantTransactions(headers, params);
  } catch (err) {
    // Network error / timeout — tidak ada retry (satu percobaan per sesi valid).
    throw new UpstreamError(0, err instanceof Error ? err.message : "network error");
  }

  if (result.status === 401) {
    console.warn("[gojek] Sesi expired (401). Memulai auto-refresh...");
    const refreshed = await refreshSession();
    if (!refreshed) throw new UpstreamError(401, "refresh token gagal");
    const newHeaders = await getValidHeaders(opts?.userAgent);
    if (!newHeaders) throw new MissingSessionError();
    result = await fetchMerchantTransactions(newHeaders, params).catch(() => {
      throw new UpstreamError(0, "network error saat retry");
    });
  }

  if (result.status < 200 || result.status >= 300) {
    throw new UpstreamError(result.status, `upstream HTTP ${result.status}`);
  }
  return result.json;
}

/** Amount dari upstream x100 (contoh: 200000 -> 2000 rupiah). */
export function normalizeGojekAmount(rawAmount: unknown): number {
  const n =
    typeof rawAmount === "string"
      ? Number.parseInt(rawAmount, 10)
      : typeof rawAmount === "number"
        ? Math.round(rawAmount)
        : NaN;
  return Math.round((Number.isNaN(n) ? 0 : n) / 100);
}

/** Param query standar endpoint analytics (dipertahankan dari legacy). */
export function buildTransactionsParams(opts: {
  startTimeMs: number;
  endTimeMs: number;
  /** Offset halaman (kelipatan size). Default 0 - dipakai verifikator untuk paging. */
  from?: number;
}): UpstreamTransactionParams {
  return {
    from: opts.from ?? 0,
    size: 20,
    statuses: "SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND",
    payment_types: "QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD",
    start_time: new Date(opts.startTimeMs).toISOString(),
    end_time: new Date(opts.endTimeMs).toISOString(),
    merchant_ids: getConfiguredMerchantId().value,
  };
}
