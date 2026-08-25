"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export default function TxActions({ transactionId, status }: { transactionId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pending = status === "PENDING";

  const act = async (action: string) => {
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/transactions/${transactionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.success) {
        setNote(`Aksi "${action}" selesai (${json.data.outcome ?? json.data.transaction?.status ?? "ok"}).`);
        router.refresh();
      } else {
        setNote(json.error ?? "Aksi gagal.");
      }
    } catch {
      setNote("Jaringan bermasalah.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="glass space-y-3 p-5">
      <h2 className="text-sm font-semibold text-[var(--color-muted)]">Aksi Admin</h2>

      <button onClick={() => act("recheck")} disabled={!!busy} className="btn-accent w-full rounded-xl py-2.5 text-sm">
        {busy === "recheck" ? "Memeriksa upstream…" : "Cek Pembayaran Sekarang"}
      </button>

      <button
        onClick={() => act("cancel")}
        disabled={!pending || !!busy}
        className="btn-ghost w-full rounded-xl py-2.5 text-sm"
        title={pending ? "" : "Hanya transaksi PENDING"}
      >
        Batalkan Transaksi
      </button>

      <button
        onClick={() => act("mark_failed")}
        disabled={!pending || !!busy}
        className="w-full rounded-xl border border-[rgba(239,68,68,0.4)] py-2.5 text-sm text-[var(--color-danger)] transition-colors hover:bg-[rgba(239,68,68,0.08)] disabled:opacity-40"
        title={pending ? "" : "Hanya transaksi PENDING"}
      >
        Tandai Gagal
      </button>

      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
        Status terminal tidak dapat diubah (PAID/EXPIRED/FAILED/CANCELLED permanen) — konsistensi callback
        integrator bergantung pada invarian ini.
      </p>
      {note && <p className="rounded-lg bg-white/5 px-3 py-2 text-xs">{note}</p>}
    </div>
  );
}
