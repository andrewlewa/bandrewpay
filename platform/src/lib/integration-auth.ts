import { getDb } from "../db/index.ts";
import { sha256Hex } from "./ids.ts";
import { INBOUND_HEADERS, SIGNATURE_MAX_SKEW_MS, checkSignature } from "./hmac.ts";
import { getIntegrationSecret } from "./config-store.ts";
import { getIntegrationApp, touchLastUsed, APP_KEY_HEADER, type IntegrationApp } from "./integrations.ts";

export type AuthenticatedApp = { id: string; label: string };

export type IntegrationAuthResult =
  | { ok: true; credential?: AuthenticatedApp }
  | { ok: false; status: number; error: string };

/**
 * Verifikasi request integrasi terautentikasi HMAC v2:
 *   X-BP-Timestamp: <ms sejak epoch>
 *   X-BP-Nonce:     <string acak unik>
 *   X-BP-Signature: hex(HMAC_SHA256(secret, `${ts}.${nonce}.${sha256hex(body)}`))
 *
 * Multi-platform:
 *   X-BP-Key: <APP-xxxx>  -> secret diambil dari aplikasi terdaftar (Admin > Aplikasi);
 *                            transaksi/callback milik app tersebut memakai secret yang sama.
 *   Tanpa X-BP-Key        -> fallback secret global lama (settings/env) demi kompatibilitas;
 *                            transaksi dibuat tanpa integration_id.
 *
 * Nonce dikonsumsi atomis (INSERT OR IGNORE) -> replay ditolak.
 */
export async function verifyIntegrationRequest(req: Request): Promise<
  IntegrationAuthResult & { rawBody?: string }
> {
  const timestampHeader = req.headers.get(INBOUND_HEADERS.timestamp);
  const nonce = req.headers.get(INBOUND_HEADERS.nonce);
  const signature = req.headers.get(INBOUND_HEADERS.signature);

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return { ok: false, status: 400, error: "body tidak dapat dibaca" };
  }

  const tsMs = timestampHeader ? Number(timestampHeader) : NaN;

  // --- Resolusi secret: per-app (X-BP-Key) atau global ---
  const keyHeader = req.headers.get(APP_KEY_HEADER)?.trim();
  let app: IntegrationApp | null = null;
  let secret: string;

  if (keyHeader) {
    app = getIntegrationApp(keyHeader);
    if (!app || !app.secret) {
      return { ok: false, status: 401, error: `X-BP-Key tidak dikenal: ${keyHeader}` };
    }
    if (!app.active) {
      return { ok: false, status: 401, error: "Aplikasi dinonaktifkan" };
    }
    secret = app.secret;
  } else {
    secret = getIntegrationSecret().value;
  }

  const check = checkSignature(
    secret,
    { timestampMs: Number.isFinite(tsMs) ? tsMs : undefined, nonce: nonce ?? undefined, signature: signature ?? undefined, body: rawBody }
  );
  if (!check.ok) {
    const messages: Record<string, string> = {
      missing: "header signature tidak lengkap",
      bad_timestamp: "format timestamp tidak valid",
      skew: "timestamp di luar jendela ±5 menit",
      bad_signature: "signature tidak cocok",
    };
    return { ok: false, status: 401, error: messages[check.reason] ?? "signature tidak valid" };
  }

  // Konsumsi nonce secara atomis — request ulang dengan nonce sama ditolak.
  const nonceHash = sha256Hex(`${nonce}.${tsMs}`);
  try {
    getDb()
      .prepare("INSERT INTO nonces (nonce_hash, expires_at) VALUES (?, ?)")
      .run(nonceHash, Date.now() + SIGNATURE_MAX_SKEW_MS * 2);
  } catch {
    return { ok: false, status: 401, error: "nonce sudah pernah dipakai" };
  }

  if (app) {
    touchLastUsed(app.id);
    return { ok: true, rawBody, credential: { id: app.id, label: app.label } };
  }
  return { ok: true, rawBody };
}
