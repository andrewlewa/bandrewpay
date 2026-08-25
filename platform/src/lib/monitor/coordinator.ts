import { getDb } from "../../db/index.ts";
import {
  effectiveMonitorPollIntervalMs,
  effectiveMonitorTickMs,
  effectiveMonitorViewerLeaseMs,
} from "../config-store.ts";
import { getTransaction, transitionTransaction, acquireCheckSlot, type Transaction } from "../payments/transactions-repo.ts";
import { verifyAndNotify } from "../payments/service.ts";
import { dispatchDueCallbacks } from "../callbacks/dispatcher.ts";

/**
 * Monitor coordinator — jantung anti-ban:
 *  - Browser buyer TIDAK PERNAH memicu panggilan upstream. Mereka hanya
 *    mendaftarkan "viewer lease" (heartbeat) ke DB.
 *  - Satu worker interval dalam proses ini yang memindai transaksi aktif
 *    dan melakukan MAKSIMAL SATU poll upstream per transaksi per interval.
 *  - N viewer = tetap 1 poller (GROUP BY transaction_id).
 *  - Semua interval dibaca dari settings tiap siklus -> perubahan di dashboard
 *    berlaku TANPA restart.
 */

type CoordinatorState = {
  timer?: ReturnType<typeof setTimeout>;
  ticking: boolean;
  startedAt?: number;
};

// globalThis agar aman terhadap HMR/dev double-import.
const g = globalThis as unknown as { __bandrewpayCoordinator?: CoordinatorState };
const state: CoordinatorState = (g.__bandrewpayCoordinator ??= { ticking: false });

function scheduleTick(): void {
  const tickMs = effectiveMonitorTickMs().value;
  state.timer = setTimeout(() => {
    void runTick()
      .catch((err) => console.error("[monitor] tick error:", err))
      .finally(scheduleTick);
  }, tickMs);
  if (typeof state.timer.unref === "function") state.timer.unref();
}

export function startCoordinator(): void {
  if (state.timer) return;
  state.startedAt = Date.now();
  scheduleTick();
  console.info(`[monitor] coordinator aktif (tick ${effectiveMonitorTickMs().value}ms, dinamis dari settings)`);
}

export function stopCoordinator(): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = undefined;
}

export function coordinatorStatus(): { running: boolean; startedAt: number | null; ticking: boolean } {
  return {
    running: !!state.timer,
    startedAt: state.startedAt ?? null,
    ticking: state.ticking,
  };
}

/** Satu tick penuh: expire -> verifikasi transaksi aktif -> callback due -> cleanup. */
export async function runTick(nowMs = Date.now()): Promise<{
  expired: number;
  verified: number;
  callbacksDispatched: number;
}> {
  if (state.ticking) return { expired: 0, verified: 0, callbacksDispatched: 0 };
  state.ticking = true;
  try {
    const pollIntervalMs = effectiveMonitorPollIntervalMs().value;
    const db = getDb();

    // 1) Expire transaksi lewat waktu (CAS per baris).
    let expired = 0;
    const dueRows = db
      .prepare("SELECT id FROM transactions WHERE status='PENDING' AND expires_at <= ? LIMIT 100")
      .all(nowMs) as Array<{ id: string }>;
    for (const row of dueRows) {
      if (transitionTransaction(row.id, "PENDING", "EXPIRED")) {
        expired += 1;
      }
    }

    // 2) Verifikasi transaksi PENDING yang punya viewer aktif.
    const activeIds = (
      db
        .prepare(
          `SELECT mv.transaction_id AS id
           FROM monitor_viewers mv JOIN transactions t ON t.id = mv.transaction_id
           WHERE mv.expires_at > ? AND t.status = 'PENDING' AND t.expires_at > ?
           GROUP BY mv.transaction_id`
        )
        .all(nowMs, nowMs) as Array<{ id: string }>
    ).map((r) => r.id);

    let verified = 0;
    for (const txId of activeIds) {
      if (!acquireCheckSlot(txId, pollIntervalMs)) continue;
      verified += 1;
      try {
        await verifyAndNotify(txId);
      } catch (err) {
        console.error(`[monitor] verify ${txId} gagal:`, err instanceof Error ? err.message : err);
      }
    }

    // 3) Kirim callback yang jatuh tempo.
    let callbacksDispatched = 0;
    try {
      const result = await dispatchDueCallbacks(nowMs);
      callbacksDispatched = result.attempted;
    } catch (err) {
      console.error("[monitor] dispatcher error:", err);
    }

    // 4) Cleanup: lease basi + nonce replay basi.
    db.prepare("DELETE FROM monitor_viewers WHERE expires_at <= ?").run(nowMs);
    db.prepare("DELETE FROM nonces WHERE expires_at <= ?").run(nowMs);

    return { expired, verified, callbacksDispatched };
  } finally {
    state.ticking = false;
  }
}

// --- Viewer leases (heartbeat browser) ---

export function heartbeatViewer(viewerId: string, transactionId: string): boolean {
  const db = getDb();
  const now = Date.now();
  const ttl = effectiveMonitorViewerLeaseMs().value;
  const tx = getTransaction(transactionId);
  if (!tx || tx.status !== "PENDING" || tx.expires_at <= now) return false;

  db.prepare(
    `INSERT INTO monitor_viewers (viewer_id, transaction_id, expires_at, started_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(viewer_id) DO UPDATE SET
       transaction_id = excluded.transaction_id,
       expires_at = excluded.expires_at`
  ).run(viewerId, transactionId, now + ttl, now);
  return true;
}

export function releaseViewer(viewerId: string): void {
  getDb().prepare("DELETE FROM monitor_viewers WHERE viewer_id = ?").run(viewerId);
}

export function activeViewerCount(transactionId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM monitor_viewers WHERE transaction_id = ? AND expires_at > ?")
    .get(transactionId, Date.now()) as unknown as { c: number } | undefined;
  return row?.c ?? 0;
}

export function getMonitoredTransaction(transactionId: string): Transaction | null {
  return getTransaction(transactionId);
}
