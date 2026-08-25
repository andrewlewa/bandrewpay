import { getDb } from "../../db/index.ts";
import { newUuid, newTransactionId } from "../ids.ts";
import { canTransition, type TransactionStatus } from "./state-machine.ts";

// --- Types ---

export type Transaction = {
  id: string;
  order_id: string;
  integration_id: string | null;
  provider: string;
  amount: number;
  /** Nominal aktual di QRIS = amount + kode unik 1..100 (anti-bentrok nominal sama). */
  payable_amount: number;
  status: TransactionStatus;
  qris_payload: string | null;
  customer_name: string | null;
  customer_email: string | null;
  callback_url: string | null;
  redirect_url: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
  expired_at: number | null;
  paid_amount: number | null;
  matched_provider_tx: string | null;
  last_checked_at: number | null;
};

type TxExtraFields = {
  paid_amount?: number;
  matched_provider_tx?: string;
  paid_at?: number;
  expired_at?: number;
};

// --- Queries ---

export function getTransaction(id: string): Transaction | null {
  const row = getDb().prepare("SELECT * FROM transactions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? (row as unknown as Transaction) : null;
}

export function findPendingByOrderId(orderId: string): Transaction | null {
  const row = getDb()
    .prepare("SELECT * FROM transactions WHERE order_id = ? AND status = 'PENDING' LIMIT 1")
    .get(orderId) as Record<string, unknown> | undefined;
  return row ? (row as unknown as Transaction) : null;
}

/**
 * True bila ada transaksi PENDING yang BELUM kedaluwarsa dengan payable_amount sama.
 * Dipakai saat memilih kode unik agar dua QRIS aktif tidak pernah bernominal sama.
 */
export function isPayableAmountActive(payable: number): boolean {
  return !!getDb()
    .prepare(
      "SELECT 1 FROM transactions WHERE payable_amount = ? AND status = 'PENDING' AND expires_at > ? LIMIT 1"
    )
    .get(payable, Date.now());
}

export type ListFilter = {
  status?: TransactionStatus;
  orderId?: string;
  limit?: number;
  offset?: number;
};

export function listTransactions(filter: ListFilter = {}): { items: Transaction[]; total: number } {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter.orderId) {
    where.push("order_id LIKE ?");
    args.push(`%${filter.orderId}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    getDb().prepare(`SELECT COUNT(*) AS c FROM transactions ${whereSql}`).get(...args) as {
      c: number;
    }
  ).c;
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const items = getDb()
    .prepare(
      `SELECT * FROM transactions ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as unknown as Transaction[];
  return { items, total };
}

export function transactionStats(): {
  pending: number;
  paidToday: number;
  expiredToday: number;
  volumeToday: number;
} {
  const db = getDb();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const startMs = dayStart.getTime();
  const count = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...args) as { c: number }).c;
  return {
    pending: count("SELECT COUNT(*) AS c FROM transactions WHERE status = 'PENDING'"),
    paidToday: count("SELECT COUNT(*) AS c FROM transactions WHERE status='PAID' AND paid_at >= ?", startMs),
    expiredToday: count(
      "SELECT COUNT(*) AS c FROM transactions WHERE status='EXPIRED' AND expired_at >= ?",
      startMs
    ),
    volumeToday:
      count("SELECT COALESCE(SUM(paid_amount),0) AS c FROM transactions WHERE status='PAID' AND paid_at >= ?", startMs),
  };
}

// --- Writes ---

export class IdempotentConflictError extends Error {
  existingId: string;
  constructor(existingId: string) {
    super("Sudah ada transaksi PENDING untuk order_id ini");
    this.name = "IdempotentConflictError";
    this.existingId = existingId;
  }
}

export function insertTransaction(input: {
  order_id: string;
  amount: number;
  payable_amount: number;
  qris_payload: string;
  integration_id: string | null;
  callback_url: string | null;
  redirect_url: string | null;
  customer_name: string | null;
  customer_email: string | null;
  expires_at: number;
}): Transaction {
  const db = getDb();
  const now = Date.now();
  // Partial unique index idx_one_pending_per_order menjamin idempotensi create.
  const existing = findPendingByOrderId(input.order_id);
  if (existing) throw new IdempotentConflictError(existing.id);
  const id = newTransactionId();
  try {
    db.prepare(
      `INSERT INTO transactions
         (id, order_id, integration_id, provider, amount, payable_amount, status, qris_payload,
          customer_name, customer_email, callback_url, redirect_url,
          expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'gopay', ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.order_id,
      input.integration_id,
      input.amount,
      input.payable_amount,
      input.qris_payload,
      input.customer_name,
      input.customer_email,
      input.callback_url,
      input.redirect_url,
      input.expires_at,
      now,
      now
    );
  } catch (err) {
    // Race dengan request paralel yang sama -> kembalikan transaksi existing.
    const existing2 = findPendingByOrderId(input.order_id);
    if (existing2) throw new IdempotentConflictError(existing2.id);
    throw err;
  }
  recordEvent(id, "CREATED", { amount: input.amount, payable_amount: input.payable_amount, order_id: input.order_id });
  return getTransaction(id)!;
}

export function recordEvent(transactionId: string, eventType: string, payload?: unknown): void {
  getDb()
    .prepare(
      "INSERT INTO payment_events (transaction_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(transactionId, eventType, payload === undefined ? null : JSON.stringify(payload), Date.now());
}

export function listEvents(transactionId: string): Array<{ id: number; event_type: string; payload_json: string | null; created_at: number }> {
  return getDb()
    .prepare("SELECT id, event_type, payload_json, created_at FROM payment_events WHERE transaction_id = ? ORDER BY id ASC")
    .all(transactionId) as Array<{ id: number; event_type: string; payload_json: string | null; created_at: number }>;
}

/**
 * Compare-and-set transisi status. Mengembalikan true jika caller yang memenangkan
 * transisi; false jika status sudah berubah oleh proses lain.
 */
export function transitionTransaction(
  txId: string,
  from: TransactionStatus,
  to: TransactionStatus,
  extra: TxExtraFields = {}
): boolean {
  if (!canTransition(from, to)) return false;
  const db = getDb();
  const now = Date.now();

  const sets: string[] = ["status = ?", "updated_at = ?"];
  const args: unknown[] = [to, now];
  if (extra.paid_amount !== undefined) {
    sets.push("paid_amount = ?");
    args.push(extra.paid_amount);
  }
  if (extra.matched_provider_tx !== undefined) {
    sets.push("matched_provider_tx = ?");
    args.push(extra.matched_provider_tx);
  }
  if (to === "PAID") {
    sets.push("paid_at = ?");
    args.push(extra.paid_at ?? now);
  }
  if (to === "EXPIRED") {
    sets.push("expired_at = ?");
    args.push(now);
  }
  args.push(txId, from);

  let changed = false;
  db.transaction(() => {
    const result = db
      .prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ? AND status = ?`)
      .run(...args);
    changed = result.changes > 0;
    if (changed) {
      recordEvent(txId, `STATUS_${to}`, { from });
    }
  })();
  return changed;
}

/** Throttle upstream check: CAS last_checked_at bila cukup lama sejak cek terakhir. */
export function acquireCheckSlot(txId: string, minIntervalMs: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE transactions SET last_checked_at = ?
       WHERE id = ? AND (last_checked_at IS NULL OR last_checked_at <= ?)`
    )
    .run(Date.now(), txId, Date.now() - minIntervalMs);
  return result.changes > 0;
}
