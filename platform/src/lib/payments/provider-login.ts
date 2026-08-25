/**
 * Login OTP GoBiz/GoFood Merchant dari dashboard admin.
 *
 * Port setia dari login.js legacy (reverse-engineered, jangan "diperbaiki"):
 *  1. POST https://api.gobiz.co.id/goid/login/request  {client_id, phone_number(lokal), country_code:"62"}
 *  2. POST https://api.gobiz.co.id/goid/token          {grant_type:"otp", data:{otp, otp_token}}
 *  3. GET  https://api.gobiz.co.id/goresto/v5/public/users/config (Bearer) -> info merchant
 *
 * Sesi hasil login disimpan di SQLite (provider_session), bukan file plaintext.
 * ATURAN KEAMANAN: token tidak pernah dikembalikan/di-log; hanya metadata.
 */

import crypto from "node:crypto";
import { checkRate } from "../rate-limit.ts";
import { saveSession, type ProviderSession } from "./gojek.ts";

export const GOBIZ_OTP_REQUEST_URL = "https://api.gobiz.co.id/goid/login/request";
export const GOBIZ_TOKEN_URL = "https://api.gobiz.co.id/goid/token";
export const GOBIZ_MERCHANT_CONFIG_URL = "https://api.gobiz.co.id/goresto/v5/public/users/config";

/** Header impersonasi browser — disalin apa adanya dari login.js legacy. */
function loginHeaders(deviceUniqueId: string): Record<string, string> {
  return {
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
    "x-uniqueid": deviceUniqueId,
    "x-user-locale": "en-GB",
    "x-user-type": "merchant",
  };
}

/** Normalisasi nomor ke format lokal tanpa awalan (0812.. -> 812...). */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("62")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits || digits.length < 8 || digits.length > 13) return null;
  return digits;
}

export function maskPhone(phone: string | null): string {
  if (!phone) return "(tidah diketahui)";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;
  return `${phone.slice(0, Math.max(phone.length - 4 - Math.floor(digits.length / 3), 1))}${"*".repeat(
    Math.max(digits.length - 6, 3)
  )}${phone.slice(-4)}`;
}

// --- Pending OTP state (in-process; satu instance server) ---

type PendingOtp = {
  otpToken: string;
  phoneNumberLocal: string;
  length: number;
  expiresAtMs: number;
};

const g = globalThis as unknown as {
  __bpPendingOtp?: PendingOtp;
  __bpOtpRequestLog?: number[];
};

export function getPendingMeta(): { exists: boolean; maskedPhone: string | null; expiresInSec: number } {
  const p = g.__bpPendingOtp;
  if (!p) return { exists: false, maskedPhone: null, expiresInSec: 0 };
  const remaining = Math.max(0, Math.round((p.expiresAtMs - Date.now()) / 1000));
  if (!remaining) return { exists: false, maskedPhone: null, expiresInSec: 0 };
  return { exists: true, maskedPhone: maskPhone(`+62${p.phoneNumberLocal}`), expiresInSec: remaining };
}

export function clearPending(): void {
  g.__bpPendingOtp = undefined;
}

export type OtpRequestResult =
  | { ok: true; channel: string; otpLength: number; expiresInSec: number }
  | { ok: false; error: string };

/**
 * Minta OTP ke GoBiz. Rate-limit ketat: maksimal 3 request per 15 menit
 * (upstream bisa membatasi/membanned nomor merchant yang terlalu sering).
 */
export async function requestOtp(rawPhone: string): Promise<OtpRequestResult> {
  const log = (g.__bpOtpRequestLog ??= []).filter((t) => Date.now() - t < 15 * 60_000);
  g.__bpOtpRequestLog = log;
  if (log.length >= 3) {
    return { ok: false, error: "Batas permintaan OTP tercapai (3 per 15 menit). Coba lagi nanti." };
  }
  const phone = normalizePhone(String(rawPhone ?? ""));
  if (!phone) return { ok: false, error: "Nomor HP tidak valid (contoh: 081234567890)." };

  try {
    const res = await fetch(GOBIZ_OTP_REQUEST_URL, {
      method: "POST",
      headers: loginHeaders(crypto.randomUUID()),
      body: JSON.stringify({ client_id: "go-biz-web-new", phone_number: phone, country_code: "62" }),
      signal: AbortSignal.timeout(15_000),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* respons non-JSON */
    }
    if (!res.ok) {
      return { ok: false, error: `GoBiz menolak permintaan OTP (HTTP ${res.status}).` };
    }
    const data = (body.data ?? body) as Record<string, unknown>;
    const otpToken = typeof data.otp_token === "string" ? data.otp_token : "";
    if (!otpToken) return { ok: false, error: "Respon GoBiz tidak berisi otp_token." };

    const nextState = (data.next_state ?? {}) as Record<string, unknown>;
    const channel = typeof nextState.state === "string" ? nextState.state.toUpperCase() : "SMS";

    g.__bpPendingOtp = {
      otpToken,
      phoneNumberLocal: phone,
      length: typeof data.otp_length === "number" ? data.otp_length : 4,
      expiresAtMs: Date.now() + (typeof data.otp_expires_in === "number" ? data.otp_expires_in : 720) * 1000,
    };
    log.push(Date.now());
    return {
      ok: true,
      channel,
      otpLength: g.__bpPendingOtp.length,
      expiresInSec: Math.round((g.__bpPendingOtp.expiresAtMs - Date.now()) / 1000),
    };
  } catch (err) {
    clearPending();
    return { ok: false, error: err instanceof Error ? err.message : "network error saat minta OTP" };
  }
}

export type OtpVerifyResult =
  | { ok: true; session: { masked_phone: string; merchant_id: string | null; outlet_name: string | null } }
  | { ok: false; error: string };

type TokenResponseShape = {
  access_token?: string;
  refresh_token?: string;
  data?: { access_token?: string; refresh_token?: string };
};

/** Tukar OTP dengan token, ambil info merchant, lalu simpan sesi ke SQLite. */
export async function verifyOtp(otpRaw: string): Promise<OtpVerifyResult> {
  const pendingOtp = g.__bpPendingOtp;
  const otp = String(otpRaw ?? "").trim();
  if (!pendingOtp) return { ok: false, error: "Tidak ada permintaan OTP aktif. Minta OTP dulu." };
  if (Date.now() > pendingOtp.expiresAtMs) {
    clearPending();
    return { ok: false, error: "Kode OTP kedaluwarsa. Minta OTP baru." };
  }
  if (!otp || otp.replace(/\D/g, "").length !== pendingOtp.length) {
    return { ok: false, error: `Kode OTP harus ${pendingOtp.length} digit.` };
  }

  try {
    const tokenRes = await fetch(GOBIZ_TOKEN_URL, {
      method: "POST",
      headers: loginHeaders(crypto.randomUUID()),
      body: JSON.stringify({
        client_id: "go-biz-web-new",
        grant_type: "otp",
        data: { otp, otp_token: pendingOtp.otpToken },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    let tokenBody: TokenResponseShape = {};
    try {
      tokenBody = (await tokenRes.json()) as TokenResponseShape;
    } catch {
      /* non-JSON */
    }
    if (!tokenRes.ok) {
      // OTP salah/kedaluwarsa biasanya 4xx dari upstream.
      clearPending();
      return { ok: false, error: `Verifikasi OTP gagal (HTTP ${tokenRes.status}). Periksa kode & coba minta OTP baru.` };
    }
    const accessToken = tokenBody.access_token || tokenBody.data?.access_token;
    const refreshToken = tokenBody.refresh_token || tokenBody.data?.refresh_token;
    if (!accessToken) {
      clearPending();
      return { ok: false, error: "Respon token tidak berisi access_token." };
    }

    // Info merchant (boleh gagal — sesi tetap valid).
    let merchantId: string | null = null;
    let outletName: string | null = null;
    try {
      const cfgRes = await fetch(GOBIZ_MERCHANT_CONFIG_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "authentication-type": "go-id",
          Origin: "https://portal.gofoodmerchant.co.id",
          Referer: "https://portal.gofoodmerchant.co.id/",
          Accept: "application/json, text/plain, */*",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as { merchant?: { id?: string; outlet_name?: string } };
        merchantId = cfg.merchant?.id ?? null;
        outletName = cfg.merchant?.outlet_name ?? null;
      }
    } catch {
      /* abaikan — opsional */
    }

    const fullPhone = `+62${pendingOtp.phoneNumberLocal}`;
    const cookieString = `access_token=${accessToken}; refresh_token=${refreshToken ?? ""}; auth_method=goid`;
    // +24 jam adalah asumsi legacy (bukan nilai server upstream).
    const session: ProviderSession = {
      phone_number: fullPhone,
      merchant_id: merchantId,
      outlet_name: outletName ?? "Merchant GoPay",
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      cookie: cookieString,
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    saveSession(session);
    clearPending();
    return {
      ok: true,
      session: {
        masked_phone: maskPhone(fullPhone),
        merchant_id: merchantId,
        outlet_name: session.outlet_name,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error saat verifikasi OTP" };
  }
}
