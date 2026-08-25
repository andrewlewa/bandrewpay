"use client";

import { useState } from "react";
import Link from "next/link";

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

type CreateResult = {
  transaction_id: string;
  order_id: string;
  amount: number;
  payable_amount: number;
  payment_url: string;
  qr_url: string;
  expires_at: number;
  reused: boolean;
  detail_url: string;
};

export default function CreatePaymentForm() {
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = { amount: amount.replace(/\D/g, "") };
      if (orderId.trim()) body.order_id = orderId.trim();
      if (customerName.trim()) body.customer_name = customerName.trim();
      if (customerEmail.trim()) body.customer_email = customerEmail.trim();
      if (callbackUrl.trim()) body.callback_url = callbackUrl.trim();
      if (redirectUrl.trim()) body.redirect_url = redirectUrl.trim();

      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data as CreateResult);
      } else {
        setError(json.error ?? `Gagal (${res.status}).`);
      }
    } catch {
      setError("Jaringan bermasalah.");
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${result.payment_url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard ditolak — biarkan user salin manual */
    }
  };

  if (result) {
    const expiry = new Date(result.expires_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return (
      <div className="glass space-y-4 p-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="badge badge-paid">Berhasil</span>
          {result.reused && <span className="badge badge-pending">order sudah ada — transaksi lama dipakai</span>}
        </div>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.qr_url}
            alt={`QRIS ${result.order_id}`}
            width={220}
            height={220}
            className="h-56 w-56 rounded-xl bg-white p-2"
          />
          <dl className="min-w-0 flex-1 space-y-2">
            <Field label="Transaction ID" value={result.transaction_id} mono />
            <Field label="Order ID" value={result.order_id} mono />
            <Field
              label="Nominal tagihan"
              value={new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(result.amount)}
            />
            {result.payable_amount !== result.amount && (
              <Field
                label="Dibayar via QRIS"
                value={`${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(result.payable_amount)} (kode unik +${result.payable_amount - result.amount})`}
              />
            )}
            <Field label="Kedaluwarsa ±" value={expiry} />
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          <a href={result.payment_url} target="_blank" rel="noopener" className="btn-accent rounded-xl px-4 py-2">
            Buka halaman bayar
          </a>
          <button type="button" onClick={copyUrl} className="btn-ghost rounded-xl px-4 py-2">
            {copied ? "Tersalin ✓" : "Salin tautan"}
          </button>
          <Link href={result.detail_url} className="btn-ghost rounded-xl px-4 py-2">
            Detail transaksi
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setOrderId("");
              setAmount("");
              setCustomerName("");
              setCustomerEmail("");
              setCallbackUrl("");
              setRedirectUrl("");
            }}
            className="btn-ghost ml-auto rounded-xl px-4 py-2"
          >
            + Buat lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass space-y-4 p-5 text-sm">
      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
          Order ID <span className="normal-case">(kosongkan untuk otomatis)</span>
        </span>
        <input
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          placeholder="INV-001 / otomatis MAN-…"
          maxLength={128}
          className="input-dark font-mono text-xs"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Nominal (IDR)</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          required
          placeholder="25000"
          className="input-dark"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Nama pembeli</span>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="opsional" className="input-dark" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Email pembeli</span>
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="opsional"
            className="input-dark"
          />
        </label>
      </div>

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs text-[var(--color-accent)] underline-offset-2 hover:underline">
        {advanced ? "− Sembunyikan opsi lanjutan" : "+ Opsi lanjutan (callback & redirect)"}
      </button>

      {advanced && (
        <div className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Callback URL</span>
            <input
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder="https://… (webhook saat PAID)"
              className="input-dark font-mono text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Redirect URL</span>
            <input
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://… (tombol selesai bayar)"
              className="input-dark font-mono text-xs"
            />
          </label>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

      <button type="submit" disabled={busy || !amount} className="btn-accent w-full rounded-xl py-2.5 disabled:opacity-50">
        {busy ? "Membuat…" : "Buat QRIS Pembayaran"}
      </button>
    </form>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0">
      <dt className="shrink-0 text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</dt>
      <dd className={`truncate text-right ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
