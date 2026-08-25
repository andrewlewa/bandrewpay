import { getDb } from "../../db/index.ts";
import { effectiveCallbackTimeoutMs } from "../config-store.ts";
import { newUuid } from "../ids.ts";
import { buildCallbackHeaders, computeSignature } from "../hmac.ts";
import { getIntegrationSecret } from "../config-store.ts";
import { getTransaction } from "../payments/transactions-repo.ts";
import { getIntegrationApp } from "../integrations.ts";
import type { Transaction } from "../payments/transactions-repo.ts";

/**
 * Outbox callback ke integrator (Paymenter).
 * - Event id unik (uuid) -> receiver bisa dedup.
 * - Payload ditandatangani HMAC v2 (timestamp + nonce + body hash).
 * - Retry dengan exponential backoff; riwayat attempt tersimpan.
 */

export const CALLBACK_BACKOFF_SECONDS = [60, 300, 900, 3600, 14400] as const;

export function buildPaidPayload(tx: Transaction, eventId: string): string {
  return JSON.stringify({
    event: "payment.paid",
    event_id: eventId,
    transaction_id: tx.id,
    order_id: tx.order_id,
    status: "paid" as const,
    amount: tx.paid_amount ?? tx.amount,
    original_amount: tx.amount,
    paid_at: new Date(tx.paid_at ?? Date.now()).toISOString(),
    customer: {
      name: tx.customer_name,
      email: tx.customer_email,
    },
  });
}

/** Antrekan pengiriman callback "paid" untuk transaksi. Idempoten per transaksi. */
export async function enqueueCallback(tx: Transaction): Promise<void> {
  if (!tx.callback_url) return;
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM callback_deliveries WHERE transaction_id = ? AND event_type = 'payment.paid'")
    .get(tx.id) as { id: string } | undefined;
  if (existing) return; // sudah pernah diantrekan

  const eventId = newUuid();
  db.prepare(
    `INSERT INTO callback_deliveries
       (id, transaction_id, url, event_type, payload_json, status, attempts, max_attempts, next_retry_at, created_at)
     VALUES (?, ?, ?, 'payment.paid', ?, 'PENDING', 0, ?, ?, ?)`
  ).run(eventId, tx.id, tx.callback_url, buildPaidPayload(tx, eventId), CALLBACK_BACKOFF_SECONDS.length + 1, Date.now(), Date.now());
}

export type DispatchResult = { attempted: number };

/**
 * Kirim semua callback yang jatuh tempo (dipanggil coordinator & test).
 * Aman dipanggil berulang: hanya mengambil baris berstatus PENDING/FAILED yang due,
 * dan mengunci tiap delivery secara optimis via CAS attempts sebelum fetch.
 */
export async function dispatchDueCallbacks(nowMs = Date.now()): Promise<DispatchResult> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id FROM callback_deliveries
       WHERE status IN ('PENDING', 'FAILED') AND next_retry_at <= ?
       ORDER BY next_retry_at ASC LIMIT 20`
    )
    .all(nowMs) as Array<{ id: string }>;

  let attempted = 0;
  for (const row of due) {
    const claimed = db
      .prepare(
        `UPDATE callback_deliveries SET attempts = attempts + 1
         WHERE id = ? AND status IN ('PENDING', 'FAILED')`
      )
      .run(row.id);
    if (claimed.changes === 0) continue; // pekerja lain / state berubah

    const delivery = db.prepare("SELECT * FROM callback_deliveries WHERE id = ?").get(row.id) as
      | {
          id: string;
          transaction_id: string;
          url: string;
          payload_json: string;
          attempts: number;
          max_attempts: number;
        }
      | undefined;
    if (!delivery) continue;

    attempted += 1;
    // Secret per aplikasi bila transaksi dibuat dengan X-BP-Key; fallback global.
    const txForSecret = getTransaction(delivery.transaction_id);
    const app = txForSecret?.integration_id ? getIntegrationApp(txForSecret.integration_id) : null;
    const secret = app?.secret || getIntegrationSecret().value;
    const headers = buildCallbackHeaders(secret, delivery.payload_json);
    let success = false;
    let responseCode: number | null = null;
    let errorText: string | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveCallbackTimeoutMs().value);
      try {
        const res = await fetch(delivery.url, {
          method: "POST",
          headers,
          body: delivery.payload_json,
          signal: controller.signal,
        });
        responseCode = res.status;
        success = res.status >= 200 && res.status < 300;
        // Konsumsi body agar koneksi tidak menggantung.
        await res.arrayBuffer().catch(() => undefined);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
    }

    recordAttempt(db, delivery.id, delivery.attempts, success, responseCode, errorText);

    if (success) {
      db.prepare(
        `UPDATE callback_deliveries SET status='SUCCESS', delivered_at=?, last_response_code=?, last_error=NULL WHERE id=?`
      ).run(Date.now(), responseCode, delivery.id);
      console.info(`[callback] ${delivery.id} terkirim (${responseCode})`);
    } else if (delivery.attempts >= delivery.max_attempts) {
      db.prepare(
        `UPDATE callback_deliveries SET status='GIVING_UP', last_response_code=COALESCE(?, last_response_code), last_error=? WHERE id=?`
      ).run(responseCode, errorText, delivery.id);
      console.error(`[callback] ${delivery.id} menyerah setelah ${delivery.attempts} percobaan`);
    } else {
      const backoffSeconds =
        CALLBACK_BACKOFF_SECONDS[Math.min(delivery.attempts - 1, CALLBACK_BACKOFF_SECONDS.length - 1)] ?? 60;
      db.prepare(
        `UPDATE callback_deliveries SET status='FAILED', next_retry_at=?, last_response_code=?, last_error=? WHERE id=?`
      ).run(Date.now() + backoffSeconds * 1000, responseCode, errorText, delivery.id);
      console.warn(`[callback] ${delivery.id} gagal, retry dalam ${backoffSeconds}s`);
    }
  }
  return { attempted };
}

function recordAttempt(
  db: ReturnType<typeof getDb>,
  deliveryId: string,
  attemptNo: number,
  success: boolean,
  responseCode: number | null,
  error: string | null
): void {
  db.prepare(
    `INSERT INTO callback_attempts (delivery_id, attempt_no, success, response_code, error, attempted_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(deliveryId, attemptNo, success ? 1 : 0, responseCode, error, Date.now());
}

/** Utilitas test: verifikasi signature outbound callback. */
export function verifyCallbackSignature(secret: string, timestamp: string, nonce: string, body: string, signature: string): boolean {
  return computeSignature(secret, Number(timestamp), nonce, body) === signature.toLowerCase();
}
