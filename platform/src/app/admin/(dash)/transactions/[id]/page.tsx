import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransaction, listEvents } from "@/lib/payments/transactions-repo";
import { activeViewerCount } from "@/lib/monitor/coordinator";
import { rupiah, dateTime } from "../../format.ts";
import TxActions from "./TxActions.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Detail Transaksi" };

export default async function TransactionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^TRX-[0-9a-fA-F]{16}$/.test(id)) notFound();
  const tx = getTransaction(id);
  if (!tx) notFound();
  const events = listEvents(id);

  return (
    <div className="bp-stagger space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/admin/transactions" className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs">← Kembali</Link>
        <h1 className="break-all font-mono text-sm font-bold">{tx.id}</h1>
        <span className={`badge badge-${tx.status.toLowerCase()}`}>{tx.status}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass space-y-2 p-5 text-sm lg:col-span-2">
          <Row label="Order ID" value={tx.order_id} mono />
          <Row label="Nominal" value={rupiah(tx.amount)} />
          <Row
            label="Nominal QRIS (kode unik)"
            value={tx.payable_amount && tx.payable_amount !== tx.amount ? `${rupiah(tx.payable_amount)} (+${tx.payable_amount - tx.amount})` : rupiah(tx.payable_amount || tx.amount)}
          />
          <Row label="Dibayar" value={tx.paid_amount ? rupiah(tx.paid_amount) : "—"} />
          <Row label="Provider TX" value={tx.matched_provider_tx ?? "—"} mono />
          <Row label="Customer" value={[tx.customer_name, tx.customer_email].filter(Boolean).join(" · ") || "—"} />
          <Row label="Callback URL" value={tx.callback_url ?? "—"} mono small />
          <Row label="Redirect URL" value={tx.redirect_url ?? "—"} mono small />
          <Row label="Dibuat" value={dateTime(tx.created_at)} />
          <Row label="Kedaluwarsa" value={dateTime(tx.expires_at)} />
          <Row label="Dibayar Pada" value={dateTime(tx.paid_at)} />
          <Row label="Cek Provider Terakhir" value={dateTime(tx.last_checked_at)} />
          <Row label="Viewer Aktif" value={String(activeViewerCount(tx.id))} />

          {tx.status === "PENDING" && (
            <div className="pt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/pay/${tx.id}/qr.png`}
                alt="QR"
                width={140}
                height={140}
                className="rounded-lg bg-white p-1.5"
              />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <TxActions transactionId={tx.id} status={tx.status} />
        </div>
      </div>

      <div className="glass p-0">
        <h2 className="px-5 pt-4 text-sm font-semibold text-[var(--color-muted)]">Riwayat Event (append-only)</h2>
        <div className="overflow-x-auto p-2">
          <table className="table-dark w-full">
            <thead><tr><th>#</th><th>Event</th><th>Payload</th><th>Waktu</th></tr></thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="text-xs">{ev.id}</td>
                  <td><span className="badge badge-pending">{ev.event_type}</span></td>
                  <td className="max-w-[10rem] truncate font-mono text-[11px] sm:max-w-md">{ev.payload_json ?? "—"}</td>
                  <td className="whitespace-normal text-xs text-[var(--color-muted)]">{dateTime(ev.created_at)}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-xs">Belum ada event.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-0 sm:gap-6">
      <span className="shrink-0 text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${small ? "break-all text-right text-[11px]" : "text-right text-xs font-medium"} max-w-xs break-all`}>
        {value}
      </span>
    </div>
  );
}
