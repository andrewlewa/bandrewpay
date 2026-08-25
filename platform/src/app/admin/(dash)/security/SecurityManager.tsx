"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

type BlockRow = { ip: string; reason: string; blocked_at: string; expires: string; active: boolean };

export default function SecurityManager({ initial }: { initial: BlockRow[] }) {
  const router = useRouter();
  const [ip, setIp] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const block = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/security/ip-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({
          ip: ip.trim(),
          minutes: minutes.trim() === "" ? null : Number(minutes),
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setNote({ ok: true, text: `IP ${ip.trim()} diblokir.` });
        setIp("");
        setMinutes("");
        setReason("");
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal memblokir." });
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (target: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/security/ip-blocks?ip=${encodeURIComponent(target)}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken() },
      });
      const json = await res.json();
      if (json.success) {
        setNote({ ok: true, text: `Blokir ${target} dihapus.` });
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal." });
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass space-y-3 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Blokir IP Aktif ({initial.filter((b) => b.active).length})</h2>
        {!initial.length && <p className="text-xs text-[var(--color-muted)]">Belum ada blokir.</p>}
        <div className="space-y-2">
          {initial.map((b) => (
            <div key={b.ip} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
              <div className="text-xs">
                <code className={b.active ? "font-semibold" : "opacity-50"}>{b.ip}</code>{" "}
                {!b.active && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">kedaluwarsa</span>}
                <span className="ml-2 text-[var(--color-muted)]">{b.reason}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-[var(--color-muted)]">{b.blocked_at} → {b.expires}</span>
                <button type="button" disabled={busy} onClick={() => unblock(b.ip)} className="text-[11px] uppercase tracking-wider text-[var(--color-danger)] hover:underline disabled:opacity-40">
                  buka blokir
                </button>
              </div>
            </div>
          ))}
        </div>
        {note && (
          <p className={`rounded-lg px-3 py-2 text-xs ${note.ok ? "bg-[rgba(34,197,94,0.12)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"}`}>
            {note.text}
          </p>
        )}
      </div>

      <form onSubmit={block} className="glass grid gap-3 p-5 text-sm sm:grid-cols-[1fr_140px_1fr_auto] sm:items-end">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Alamat IP</span>
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.111" className="input-dark w-full" />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Durasi (menit)</span>
          <input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} placeholder="kosong = permanen" className="input-dark w-full" />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Alasan (opsional)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. percobaan brute force" className="input-dark w-full" />
        </label>
        <button disabled={busy || !ip.trim()} className="btn-accent rounded-xl px-6 py-2.5 disabled:opacity-40">
          Blokir
        </button>
      </form>
    </div>
  );
}
