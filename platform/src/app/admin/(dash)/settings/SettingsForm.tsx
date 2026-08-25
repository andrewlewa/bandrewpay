"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SettingRow } from "./page.tsx";

type SecretInfo = Record<"integration_secret" | "session_secret", string>;

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

const SOURCE_BADGE: Record<string, { text: string; cls: string }> = {
  settings: { text: "dashboard", cls: "bg-[rgba(34,197,94,0.14)] text-[var(--color-ok)]" },
  env: { text: ".env", cls: "bg-[rgba(59,130,246,0.14)] text-[rgb(147,197,253)]" },
  default: { text: "default", cls: "bg-white/10 text-[var(--color-muted)]" },
  generated: { text: "generated", cls: "bg-[rgba(234,179,8,0.14)] text-[rgb(250,204,21)]" },
  unset: { text: "belum diatur", cls: "bg-[rgba(239,68,68,0.14)] text-[var(--color-danger)]" },
};

function Badge({ source }: { source: string }) {
  const b = SOURCE_BADGE[source] ?? SOURCE_BADGE.default;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.text}</span>;
}

export default function SettingsForm({
  rows,
  overrides,
  secretInfo,
}: {
  rows: SettingRow[];
  overrides: Record<string, { updated_at?: number }>;
  secretInfo: SecretInfo;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const save = async (payload: Record<string, string>, okText: string) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setNote({ ok: true, text: okText });
        setValues({});
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal menyimpan." });
      }
      return json.success as boolean;
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitAll = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) payload[k] = v;
    if (!Object.keys(payload).length) {
      setNote({ ok: false, text: "Tidak ada perubahan untuk disimpan." });
      return;
    }
    await save(payload, "Pengaturan tersimpan & langsung aktif.");
  };

  const resetKey = async (key: string) => {
    const ok = await save({ [key]: "" }, `Override "${key}" dihapus — kembali ke .env/default.`);
    if (ok) setValues((prev) => ({ ...prev, [key]: "" }));
  };

  const changedCount = Object.keys(values).length;

  const renderField = (row: SettingRow) => {
    const isSecret = /secret/.test(row.key);
    const val = values[row.key] ?? "";
    const hasOverride = row.key in overrides;
    return (
      <div key={row.key} className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{row.label}</label>
          <div className="flex items-center gap-2">
            <Badge source={row.source} />
            {(hasOverride || row.source === "settings") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => resetKey(row.key)}
                className="text-[10px] uppercase tracking-wider text-[var(--color-danger)] hover:underline disabled:opacity-40"
              >
                reset
              </button>
            )}
          </div>
        </div>
        {row.key === "qris_static" ? (
          <textarea
            value={val}
            onChange={(e) => set(row.key, e.target.value)}
            rows={3}
            placeholder={`Nilai sekarang: ${row.display} — tempel payload baru untuk mengganti`}
            className="input-dark font-mono text-[11px]"
          />
        ) : (
          <input
            type={isSecret ? "password" : row.key === "app_url" ? "url" : "text"}
            inputMode={/ms$|seconds$/.test(row.key) ? "numeric" : undefined}
            value={val}
            onChange={(e) => set(row.key, isSecret || row.key !== "gopay_merchant_id" ? e.target.value : e.target.value.replace(/\D/g, ""))}
            placeholder={
              isSecret && row.source !== "unset"
                ? `Sudah diatur (${secretInfo[row.key as keyof SecretInfo]}) — kosongkan field ini jika tidak ingin mengubah`
                : `Nilai sekarang: ${row.display}`
            }
            className="input-dark"
            autoComplete="new-password"
          />
        )}
        {row.key === "payment_ttl_seconds" && (
          <Hint>Masa berlaku QR dinamis (30–86400 dtk). Default 300.</Hint>
        )}
        {row.key === "callback_timeout_ms" && <Hint>Batas waktu HTTP callback ke toko (1000–60000 ms).</Hint>}
        {row.key === "monitor_poll_interval_ms" && (
          <Hint>Jarak minimal antar-poll upstream per transaksi (4000–300000 ms). Jaga tetap besar demi anti-ban.</Hint>
        )}
        {row.key === "monitor_viewer_lease_ms" && <Hint>Masa hidup lease viewer browser (8000–120000 ms).</Hint>}
        {row.key === "monitor_tick_ms" && <Hint>Siklus koordinator monitor (1000–60000 ms).</Hint>}
        {row.key === "integration_secret" && <Hint>Minimal 32 karakter. Samakan dengan plugin Paymenter.</Hint>}
        {row.key === "session_secret" && <Hint>Minimal 32 karakter. Mengubahnya tidak mengakhiri sesi aktif.</Hint>}
        {row.key === "app_url" && <Hint>Dipakai sebagai dasar URL halaman bayar &amp; link di response API.</Hint>}
      </div>
    );
  };

  const group = (title: string, keys: string[]) => {
    const items = rows.filter((r) => keys.includes(r.key));
    if (!items.length) return null;
    return (
      <section className="space-y-3 border-t border-white/5 pt-4 first:border-0 first:pt-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {items.map(renderField)}
      </section>
    );
  };

  return (
    <form onSubmit={submitAll} className="glass space-y-4 p-5 text-sm">
      <h2 className="font-semibold text-[var(--color-muted)]">Ubah Pengaturan</h2>

      {group("Integrasi & Keamanan", ["integration_secret", "session_secret"])}
      {group("Aplikasi", ["app_url"])}
      {group("Pembayaran QRIS", ["qris_static", "gopay_merchant_id", "payment_ttl_seconds"])}
      {group("Monitor & Callback", [
        "monitor_poll_interval_ms",
        "monitor_viewer_lease_ms",
        "monitor_tick_ms",
        "callback_timeout_ms",
      ])}

      {changedCount > 0 && (
        <p className="text-xs text-[var(--color-muted)]">{changedCount} field akan disimpan.</p>
      )}

      {note && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            note.ok ? "bg-[rgba(34,197,94,0.12)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"
          }`}
        >
          {note.text}
        </p>
      )}

      <button disabled={busy} className="btn-accent w-full rounded-xl py-2.5">
        {busy ? "Menyimpan…" : "Simpan Perubahan"}
      </button>
      <PasswordSection onBusy={setBusy} />
    </form>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] leading-snug text-[var(--color-muted)]">{children}</span>;
}

function PasswordSection({ onBusy }: { onBusy: (b: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusyLocal] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!current || !next) return setNote({ ok: false, text: "Isi password lama & baru." });
    if (next !== confirm) return setNote({ ok: false, text: "Konfirmasi password tidak sama." });
    setBusyLocal(true);
    onBusy(true);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const json = await res.json();
      if (json.success) {
        setNote({ ok: true, text: "Password diganti. Sesi lain telah dicabut." });
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal mengganti password." });
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusyLocal(false);
      onBusy(false);
    }
  };

  return (
    <section className="space-y-3 border-t border-white/5 pt-4">
      <h3 className="text-sm font-semibold">Ganti Password Akun</h3>
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Password saat ini"
        className="input-dark w-full"
        autoComplete="current-password"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="Password baru (min. 8 karakter)"
          className="input-dark w-full"
          autoComplete="new-password"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Ulangi password baru"
          className="input-dark w-full"
          autoComplete="new-password"
        />
      </div>
      {note && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            note.ok ? "bg-[rgba(34,197,94,0.12)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"
          }`}
        >
          {note.text}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void submit()} className="btn-accent w-full rounded-xl py-2.5">
        {busy ? "Memproses…" : "Ganti Password"}
      </button>
    </section>
  );
}
