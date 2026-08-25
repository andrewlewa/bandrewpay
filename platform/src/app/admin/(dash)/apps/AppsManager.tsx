"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export type AppRow = {
  id: string;
  label: string;
  secret_masked: string;
  callback_url: string | null;
  redirect_url: string | null;
  active: boolean;
  created_at: number;
  last_used_at: number | null;
};

const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "—";

export default function AppsManager({ initial }: { initial: AppRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [freshSecret, setFreshSecret] = useState<{ id: string; secret: string } | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({
          label,
          callback_url: callbackUrl.trim() || undefined,
          redirect_url: redirectUrl.trim() || undefined,
          ...(manualSecret ? { secret: manualSecret } : {}),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setFreshSecret({ id: json.data.id, secret: json.data.secret });
        setNote({ ok: true, text: `Aplikasi "${label}" dibuat (${json.data.id}). Salin secret sekarang — tidak akan ditampilkan lagi.` });
        setLabel("");
        setCallbackUrl("");
        setRedirectUrl("");
        setManualSecret("");
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal membuat aplikasi." });
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, method: string, body?: Record<string, unknown>, okText = "Berhasil.") => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/apps/${id}`, {
        method,
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await res.json();
      if (json.success) {
        if (json.data?.secret) setFreshSecret({ id, secret: json.data.secret });
        setNote({ ok: true, text: json.data?.secret ? `Secret baru dibuat. Salin sekarang — hanya tampil sekali.` : okText });
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
    <div className="bp-stagger space-y-4">
      {/* Daftar aplikasi */}
      <div className="glass space-y-3 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Daftar Aplikasi ({initial.length})</h2>
        {!initial.length && <p className="text-xs text-[var(--color-muted)]">Belum ada aplikasi. Buat satu di bawah.</p>}
        {initial.map((a) => (
          <div key={a.id} className="rounded-xl border border-white/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">{a.label}</span>{" "}
                <code className="text-[11px] text-[var(--color-muted)]">{a.id}</code>{" "}
                <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.active ? "bg-[rgba(34,197,94,0.14)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.14)] text-[var(--color-danger)]"}`}>
                  {a.active ? "aktif" : "nonaktif"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => act(a.id, "PUT", { rotate_secret: true }, "Secret dirotasi.")} className="text-[11px] uppercase tracking-wider hover:underline disabled:opacity-40">
                  rotasi secret
                </button>
                <button type="button" disabled={busy} onClick={() => act(a.id, "PUT", { active: !a.active }, a.active ? "Dinonaktifkan." : "Diaktifkan.")} className="text-[11px] uppercase tracking-wider text-[rgb(250,204,21)] hover:underline disabled:opacity-40">
                  {a.active ? "nonaktifkan" : "aktifkan"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Hapus aplikasi "${a.label}"? Transaksi lama tetap tersimpan.`)) void act(a.id, "DELETE", undefined, "Aplikasi dihapus.");
                  }}
                  className="text-[11px] uppercase tracking-wider text-[var(--color-danger)] hover:underline disabled:opacity-40"
                >
                  hapus
                </button>
              </div>
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-[var(--color-muted)] sm:grid-cols-2">
              <span>Secret: <code>{a.secret_masked}</code></span>
              <span>Terakhir dipakai: {fmt(a.last_used_at)}</span>
              <span className="sm:col-span-2 truncate">Callback default: {a.callback_url ?? "(per-request)"}</span>
              <span className="sm:col-span-2 truncate">Redirect default: {a.redirect_url ?? "(tidak diset)"}</span>
            </div>
            {freshSecret?.id === a.id && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-[rgba(34,197,94,0.12)] px-3 py-2">
                <code className="flex-1 break-all text-[11px] text-[var(--color-ok)]">{freshSecret.secret}</code>
                <button type="button" onClick={() => navigator.clipboard.writeText(freshSecret.secret)} className="text-[11px] underline">
                  salin
                </button>
              </div>
            )}
          </div>
        ))}
        {note && (
          <p className={`rounded-lg px-3 py-2 text-xs ${note.ok ? "bg-[rgba(34,197,94,0.12)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"}`}>
            {note.text}
          </p>
        )}
      </div>

      {/* Form tambah */}
      <form onSubmit={create} className="glass space-y-4 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Tambah Aplikasi</h2>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Nama / Label (wajib)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. Toko Paymenter Utama" className="input-dark w-full" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Callback URL default</span>
          <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="https://toko.com/extensions/bandrewpay/webhook" className="input-dark w-full" />
          <Hint>Dipakai bila request pembayaran tidak menyertakan callback_url sendiri.</Hint>
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Redirect URL default</span>
          <input value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://toko.com/invoice/123" className="input-dark w-full" />
          <Hint>Halaman tujuan buyer setelah bayar bila request tidak menyertakan redirect_url.</Hint>
        </label>
        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Secret manual (opsional)</span>
          <input type="password" value={manualSecret} onChange={(e) => setManualSecret(e.target.value)} placeholder="kosongkan untuk auto-generate" className="input-dark w-full" autoComplete="new-password" />
          <Hint>Minimal 32 karakter. Disarankan biarkan auto-generate.</Hint>
        </label>
        <button disabled={busy || !label.trim()} className="btn-accent w-full rounded-xl py-2.5 disabled:opacity-40">
          {busy ? "Memproses…" : "Buat Aplikasi & Tampilkan Secret"}
        </button>
      </form>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] leading-snug text-[var(--color-muted)]">{children}</span>;
}
