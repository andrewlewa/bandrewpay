import { getDb } from "@/db/index";
import { rupiah, dateTime } from "../format.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Callbacks" };

export default async function CallbacksPage() {
  const db = getDb();
  const deliveries = db
    .prepare(
      `SELECT id, transaction_id, url, event_type, status, attempts, max_attempts,
              next_retry_at, last_response_code, last_error, delivered_at
       FROM callback_deliveries ORDER BY created_at DESC LIMIT 100`
    )
    .all() as Array<Record<string, unknown>>;

  const counts = db
    .prepare(
      `SELECT status, COUNT(*) AS c FROM callback_deliveries GROUP BY status`
    )
    .all() as Array<{ status: string; c: number }>;

  return (
    <div className="bp-stagger space-y-4">
      <h1 className="text-lg font-bold">Callback Outbox</h1>

      <div className="flex flex-wrap gap-2">
        {counts.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Belum ada callback.</p>
        ) : (
          counts.map((c) => (
            <span key={c.status} className={`badge badge-${c.status === "SUCCESS" ? "paid" : c.status === "GIVING_UP" ? "failed" : "pending"}`}>
              {String(c.status)}: {String(c.c)}
            </span>
          ))
        )}
      </div>

      <div className="glass overflow-x-auto p-0">
        {deliveries.length > 0 && (
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th>Event</th><th>Transaksi</th><th>Tujuan</th><th>Status</th><th>Percobaan</th>
                <th className="hidden md:table-cell">Respon</th>
                <th className="hidden md:table-cell">Retry</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => {
                const status = String(d.status);
                return (
                  <tr key={String(d.id)}>
                    <td className="font-mono text-[11px]">{String(d.id).slice(0, 8)}…</td>
                    <td className="font-mono text-xs">{String(d.transaction_id).slice(4, 12)}…</td>
                    <td className="text-xs">{truncate(String(d.url), 40)}</td>
                    <td>
                      <span className={`badge ${status === "SUCCESS" ? "badge-paid" : status === "PENDING" || status === "FAILED" ? "badge-pending" : "badge-failed"}`}>
                        {status}
                      </span>
                      {d.last_error ? <div className="mt-1 max-w-48 truncate text-[10px] text-[var(--color-danger)]">{String(d.last_error)}</div> : null}
                    </td>
                    <td className="text-xs">{Number(d.attempts)}/{Number(d.max_attempts)}</td>
                    <td className="hidden font-mono text-xs md:table-cell">{d.last_response_code === null || d.last_response_code === undefined ? "—" : String(d.last_response_code)}</td>
                    <td className="hidden text-xs text-[var(--color-muted)] md:table-cell">{status === "FAILED" ? dateTime(Number(d.next_retry_at)) : d.delivered_at ? dateTime(Number(d.delivered_at)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Callback dikirim dengan header HMAC v2 (X-BP-Timestamp/Nonce/Signature). Receiver yang benar akan dedup berdasarkan event_id.
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
