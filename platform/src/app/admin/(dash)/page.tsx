import Link from "next/link";
import { transactionStats, listTransactions } from "@/lib/payments/transactions-repo";
import { coordinatorStatus } from "@/lib/monitor/coordinator";
import { loadSession, isExpired } from "@/lib/payments/gojek";
import { rupiah } from "./format.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ringkasan" };

export default async function AdminOverview() {
  const stats = transactionStats();
  const recent = listTransactions({ limit: 8 });
  const provider = loadSession();
  const monitor = coordinatorStatus();

  return (
    <div className="bp-stagger space-y-4 sm:space-y-6">
      <h1 className="text-lg font-bold sm:text-xl">Ringkasan</h1>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Transaksi Aktif" value={String(stats.pending)} accent />
        <StatCard label="Dibayar Hari Ini" value={String(stats.paidToday)} />
        <StatCard label="Kedaluwarsa Hari Ini" value={String(stats.expiredToday)} />
        <StatCard label="Volume Hari Ini" value={rupiah(stats.volumeToday)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-muted)]">Status Monitor</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-[var(--color-muted)]">Koordinator</span>
              <span className={`badge ${monitor.running ? "badge-paid" : "badge-failed"}`}>
                {monitor.running ? "Aktif" : "Mati"}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[var(--color-muted)]">Sesi Provider</span>
              <span className={`badge ${provider && !isExpired(provider) ? "badge-paid" : "badge-failed"}`}>
                {provider ? (isExpired(provider) ? "Expired" : "OK") : "Tidak Ada"}
              </span>
            </li>
          </ul>
          <Link href="/admin/system" className="btn-ghost mt-4 block rounded-xl py-2 text-center text-xs">
            Detail Sistem →
          </Link>
        </div>

        <div className="glass p-4 lg:col-span-2 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-muted)]">Transaksi Terbaru</h2>
            <Link href="/admin/transactions" className="text-xs text-[var(--color-accent)]">
              Lihat semua →
            </Link>
          </div>
          {recent.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">Belum ada transaksi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark w-full">
                <thead>
                  <tr>
                    <th>ID</th><th className="hidden sm:table-cell">Order</th><th>Nominal</th><th>Status</th>
                    <th className="hidden sm:table-cell">Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.items.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <Link href={`/admin/transactions/${tx.id}`} className="font-mono text-xs text-[var(--color-accent)]">
                          {tx.id.slice(0, 12)}…
                        </Link>
                      </td>
                      <td className="hidden text-xs sm:table-cell">{tx.order_id}</td>
                      <td>{rupiah(tx.amount)}</td>
                      <td><span className={`badge badge-${tx.status.toLowerCase()}`}>{tx.status}</span></td>
                      <td className="hidden text-xs text-[var(--color-muted)] sm:table-cell">{new Date(tx.created_at).toLocaleTimeString("id-ID")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`glass min-w-0 p-3.5 ${accent ? "border-[rgba(249,115,22,0.35)]" : ""} sm:p-5`}>
      <p className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wider text-[var(--color-muted)] sm:text-xs">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-extrabold tabular-nums sm:text-xl lg:text-2xl">{value}</p>
    </div>
  );
}
