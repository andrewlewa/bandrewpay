import crypto from "node:crypto";
import { sha256Hex } from "./ids.ts";

/**
 * Skema tanda tangan v2 (perbaikan atas skema legacy yang rentan replay):
 *   signature = HMAC_SHA256(secret, `${timestamp}.${nonce}.${sha256hex(body)}`)
 * - timestamp milidetik; diverifikasi dalam jendela ±5 menit.
 * - nonce acak unik per request; disimpan server (hash) sampai window berlalu.
 */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export const INBOUND_HEADERS = {
  timestamp: "x-bp-timestamp",
  nonce: "x-bp-nonce",
  signature: "x-bp-signature",
} as const;

export function computeSignature(
  secret: string,
  timestampMs: number,
  nonce: string,
  body: string
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestampMs}.${nonce}.${sha256Hex(body)}`)
    .digest("hex");
}

export type SignatureParts = {
  timestampMs: number;
  nonce: string;
  signature: string;
  body: string;
};

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "bad_timestamp" | "skew" | "bad_signature"; detail?: string };

/** Verifikasi murni (tanpa side-effect). Pemeriksaan nonce dilakukan pemanggil. */
export function checkSignature(secret: string, parts: Partial<SignatureParts>, nowMs = Date.now()): SignatureCheck {
  if (
    typeof parts.timestampMs !== "number" ||
    !Number.isFinite(parts.timestampMs) ||
    typeof parts.nonce !== "string" ||
    parts.nonce.length === 0 ||
    parts.nonce.length > 128 ||
    typeof parts.signature !== "string" ||
    typeof parts.body !== "string"
  ) {
    return { ok: false, reason: "missing" };
  }
  if (!/^\d{13}$/.test(String(parts.timestampMs))) {
    return { ok: false, reason: "bad_timestamp" };
  }
  if (Math.abs(nowMs - parts.timestampMs) > SIGNATURE_MAX_SKEW_MS) {
    return { ok: false, reason: "skew" };
  }
  const expected = computeSignature(secret, parts.timestampMs, parts.nonce, parts.body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(parts.signature.toLowerCase(), "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

/** Headers untuk callback keluar ke merchant/integrator. */
export function buildCallbackHeaders(
  secret: string,
  body: string,
  nowMs = Date.now(),
  eventId?: string
): Record<string, string> {
  const nonce = eventId ?? crypto.randomBytes(16).toString("hex");
  const ts = String(nowMs);
  const signature = computeSignature(secret, nowMs, nonce, body);
  return {
    "Content-Type": "application/json",
    "User-Agent": "BandrewPay-Webhook/1.0",
    [INBOUND_HEADERS.timestamp]: ts,
    [INBOUND_HEADERS.nonce]: nonce,
    [INBOUND_HEADERS.signature]: signature,
  };
}
