import { getDb } from "../../db/index.ts";
import {
  fetchWithSessionRetry,
  buildTransactionsParams,
  normalizeGojekAmount,
  MissingSessionError,
  UpstreamError,
} from "./gojek.ts";
import { getTransaction, transitionTransaction, recordEvent, type Transaction } from "./transactions-repo.ts";

/**
 * Verifikasi pembayaran terhadap upstream GoBiz.
 *
 * Perbedaan kunci vs legacy: klaim disimpan di tabel `claims` (SQLite),
 * sehingga proteksi double-payment BERTAHAN RESTART — memperbaiki temuan
 * HIGH #2 pada audit keamanan gateway lama.
 */

export type VerifyOutcome =
  | { outcome: "MATCHED"; transaction: Transaction }
  | { outcome: "STILL_PENDING" }
  | { outcome: "ALREADY_RESOLVED"; status: string }
  | { outcome: "ERROR"; error: Error };

type RawUpstreamTx = Record<string, unknown>;
export type { RawUpstreamTx };

/** Ukuran halaman endpoint analytics (dipertahankan dari legacy). */
export const UPSTREAM_PAGE_SIZE = 20;
/**
 * Batas halaman maksimum per verifikasi.
 *
 * Trade-off yang disengaja (anti-ban): paging hanya berlanjut selama halaman
 * sebelumnya PENUH (== UPSTREAM_PAGE_SIZE), dan dibatasi 3 halaman (60 tx /
 * window 5 menit - jauh di atas kasus nyata). Kegagalan fetch pada halaman >=2
 * TIDAK menjadikan cek gagal: verifikasi degradasi ke hasil halaman yang sudah
 * terbaca (STILL_PENDING), supaya buyer tidak melihat error provider palsu.
 */
export const UPSTREAM_MAX_PAGES = 3;

function extractTransactions(json: unknown): RawUpstreamTx[] {
  // Shape respon hasil reverse-engineering — pertahankan semua fallback path.
  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as RawUpstreamTx[];
  const inner = (data as { transactions?: unknown } | undefined)?.transactions;
  if (Array.isArray(inner)) return inner as RawUpstreamTx[];
  const top = (json as { transactions?: unknown })?.transactions;
  if (Array.isArray(top)) return top as RawUpstreamTx[];
  return [];
}

function readTxId(tx: RawUpstreamTx): string | null {
  const id = tx.id ?? tx.order_id ?? tx.wallstreet_transaction_id;
  return typeof id === "string" && id ? id : null;
}

function readTxTimeMs(tx: RawUpstreamTx): number {
  const raw = tx.transaction_time ?? tx.created_at ?? tx.settlement_time;
  if (typeof raw !== "string" && typeof raw !== "number") return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function readTxAmount(tx: RawUpstreamTx): number {
  const amount = tx.gross_amount ?? tx.real_gross_amount ?? (tx.amount as { value?: unknown } | undefined)?.value ?? tx.amount;
  return normalizeGojekAmount(amount);
}

/** Coba klaim satu tx upstream untuk transactionId. True jika caller pemilik klaim. */
export function tryClaimProviderTx(transactionId: string, providerTxId: string): "claimed" | "mine" | "taken" {
  const db = getDb();
  let result: "claimed" | "mine" | "taken" = "claimed";
  db.transaction(() => {
    const existing = db
      .prepare("SELECT transaction_id FROM claims WHERE provider_tx_id = ?")
      .get(providerTxId) as { transaction_id: string } | undefined;
    if (existing) {
      result = existing.transaction_id === transactionId ? "mine" : "taken";
      return;
    }
    db.prepare("INSERT INTO claims (provider_tx_id, transaction_id, claimed_at) VALUES (?, ?, ?)").run(
      providerTxId,
      transactionId,
      Date.now()
    );
    recordEvent(transactionId, "PROVIDER_CLAIMED", { provider_tx_id: providerTxId });
  })();
  return result;
}

/**
 * Matcher MURNI: cari baris upstream yang cocok dengan payable_amount dan
 * berada dalam window waktu. Dipisah agar mudah di-unit-test.
 */
export function findMatchingRawTx(
  raws: RawUpstreamTx[],
  expectedAmount: number,
  startTimeMs: number
): RawUpstreamTx | null {
  for (const raw of raws) {
    if (readTxAmount(raw) !== expectedAmount) continue;
    if (readTxTimeMs(raw) < startTimeMs) continue;
    if (!readTxId(raw)) continue;
    return raw;
  }
  return null;
}

/**
 * Satu siklus verifikasi untuk transaksi tertentu:
 * fetch upstream sekali -> cocokkan amount & window waktu -> klaim -> PAID.
 * Pemanggil bertanggung jawab atas throttle interval (acquireCheckSlot).
 */
export async function verifyTransaction(
  transactionId: string,
  opts?: { force?: boolean; userAgent?: string | null }
): Promise<VerifyOutcome> {
  let tx = getTransaction(transactionId);
  if (!tx) return { outcome: "ERROR", error: new Error("transaksi tidak ditemukan") };
  if (tx.status !== "PENDING") {
    return { outcome: "ALREADY_RESOLVED", status: tx.status };
  }

  // Window pencarian: dibuat transaksi - buffer 5 menit.
  const startTimeMs = tx.created_at - 5 * 60 * 1000;

  // PAGING: merchant ramai bisa menggeser pembayaran buyer keluar dari
  // halaman pertama (temuan legacy ">20 tx/window"). Berhenti begitu cocok;
  // kasus umum tetap 1 request upstream.
  let matched: RawUpstreamTx | null = null;
  let pageFull = true; // halaman 0 selalu dicoba
  for (let page = 0; page < UPSTREAM_MAX_PAGES && !matched && pageFull; page++) {
    let json: unknown;
    try {
      json = await fetchWithSessionRetry(
        buildTransactionsParams({
          startTimeMs,
          endTimeMs: Date.now(),
          from: page * UPSTREAM_PAGE_SIZE,
        }),
        { userAgent: opts?.userAgent }
      );
    } catch (err) {
      // Halaman pertama gagal = masalah provider sungguhan -> laporkan error.
      // Halaman lanjutan gagal = degradasi anggun; jangan bunuh pengecekan
      // (buyer tidak boleh melihat error provider palsu karena paging).
      if (page === 0) {
        if (err instanceof MissingSessionError || err instanceof UpstreamError) {
          return { outcome: "ERROR", error: err };
        }
        return { outcome: "ERROR", error: err instanceof Error ? err : new Error(String(err)) };
      }
      console.warn(`[verifier] ${transactionId}: halaman ${page + 1} gagal (${err instanceof Error ? err.message : err}), lanjut dengan hasil terkumpul`);
      break;
    }

    // Transaksi bisa sudah berubah saat await di atas.
    tx = getTransaction(transactionId);
    if (!tx || tx.status !== "PENDING") {
      return tx ? { outcome: "ALREADY_RESOLVED", status: tx.status } : { outcome: "ERROR", error: new Error("hilang") };
    }

    const items = extractTransactions(json);
    matched = findMatchingRawTx(items, tx.payable_amount || tx.amount, startTimeMs);
    // Lanjut paging HANYA bila halaman penuh (indikator ada kelanjutan data).
    pageFull = items.length >= UPSTREAM_PAGE_SIZE;
  }

  if (!matched) {
    return { outcome: "STILL_PENDING" };
  }

  const providerTxId = readTxId(matched)!;
  const claim = tryClaimProviderTx(transactionId, providerTxId);
  if (claim === "taken") {
    console.info(`[verifier] ${providerTxId} sudah diklaim transaksi lain, skip`);
    return { outcome: "STILL_PENDING" };
  }

  const paidAtMs = readTxTimeMs(matched) || Date.now();
  const won = transitionTransaction(transactionId, "PENDING", "PAID", {
    paid_amount: tx.amount, // nominal dasar untuk integrator/callback
    matched_provider_tx: providerTxId,
    paid_at: paidAtMs,
  });
  if (won) {
    console.info(`[verifier] ${transactionId} PAID via provider tx ${providerTxId}`);
    const updated = getTransaction(transactionId)!;
    return { outcome: "MATCHED", transaction: updated };
  }
  // Kalah race CAS - status sudah berubah oleh proses lain.
  const current = getTransaction(transactionId)!;
  return { outcome: "ALREADY_RESOLVED", status: current.status };
}
