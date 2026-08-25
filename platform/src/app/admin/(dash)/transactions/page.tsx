import Link from "next/link";
import { listTransactions } from "@/lib/payments/transactions-repo";
import { rupiah, dateTime } from "../format.ts";
import type { TransactionStatus } from "@/lib/payments/state-machine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transaksi" };

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "Semua" },
  { key: "PENDING", label: "Pending" },
  { key: "PAID", label: "Dibayar" },
  { key: "EXPIRED", label: "Kedaluwarsa" },
  { key: "FAILED", label: "Gagal" },
  { key: "CANCELLED", label: "Batal" },
];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page ?? 1) || 1, 1);
  const limit = 25;
  const status = FILTERS.some((f) => f.key === sp.status && f.key !== "") ? (sp.status as TransactionStatus) : undefined;
  const { items, total } = listTransactions({ status, orderId: sp.q, limit, offset: (page - 1) * limit });
  const pages = Math.max(Math.ceil(total / limit), 1);

  return (
    <div className="bp-stagger space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <h1 className="text-lg font-bold">
          Transaksi <span className="text-sm font-normal text-[var(--color-muted)]">({total})</span>
        </h1>
        <form action="/admin/transactions" method="get" className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Cari order_id…"
            className="input-dark !py-1.5 !w-full flex-1 text-sm sm:!w-56 sm:!flex-none"
          />
          <button className="btn-ghost rounded-lg px-3 text-sm">Cari</button>
        </form>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const href = `/admin/transactions${f.key ? `?status=${f.key}` : ""}`;
          const active = (f.key === "" && !status) || f.key === sp.status;
          return (
            <Link
              key={f.label}
              href={href}
              className={`rounded-lg px-3 py-1.5 text-xs ${active ? "bg-[rgba(249,115,22,0.14)] text-[var(--color-accent)]" : "btn-ghost text-[var(--color-muted)]"}`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="glass overflow-x-auto p-0">
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">Tidak ada transaksi.</p>
        ) : (
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th>ID</th><th>Order ID</th><th>Nominal</th><th>Status</th>
                <th className="hidden md:table-cell">Dibayar</th>
                <th className="hidden md:table-cell">Dibuat</th>
                <th className="hidden lg:table-cell">Callback</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tx) => (
                <tr key={tx.id} className="hover:bg-white/[0.03]">
                  <td>
                    <Link href={`/admin/transactions/${tx.id}`} className="font-mono text-xs text-[var(--color-accent)]">
                      {tx.id.slice(4, 12)}…
                    </Link>
                  </td>
                  <td className="text-xs">{tx.order_id}</td>
                  <td>{rupiah(tx.amount)}</td>
                  <td><span className={`badge badge-${tx.status.toLowerCase()}`}>{tx.status}</span></td>
                  <td className="hidden text-xs md:table-cell">{dateTime(tx.paid_at)}</td>
                  <td className="hidden text-xs text-[var(--color-muted)] md:table-cell">{dateTime(tx.created_at)}</td>
                  <td className="hidden lg:table-cell">{tx.callback_url ? <span className={`badge ${tx.status === "PAID" ? "badge-pending" : "badge-expired"}`}>ada</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={pageUrl(sp, page - 1)} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              ← Sebelumnya
            </Link>
          )}
          <span className="text-[var(--color-muted)]">Halaman {page} / {pages}</span>
          {page < pages && (
            <Link href={pageUrl(sp, page + 1)} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              Berikutnya →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function pageUrl(sp: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  if (sp.status) params.set("status", sp.status);
  if (sp.q) params.set("q", sp.q);
  params.set("page", String(page));
  return `/admin/transactions?${params.toString()}`;
}
