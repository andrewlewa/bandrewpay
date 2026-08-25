"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)bp_csrf=([^;]+)/);
  return match?.[1] ?? "";
}

export default function ProviderStatusCard({
  rows,
  hasSession,
  pendingOtp,
}: {
  rows: Array<{ label: string; value: string; ok?: boolean }>;
  hasSession: boolean;
  pendingOtp: { exists: boolean; maskedPhone: string | null; expiresInSec: number };
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "otp-sent">("idle");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/provider/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (json.success) {
        setStep("otp-sent");
        setNote({
          ok: true,
          text: `OTP ${json.data.otp_length} digit dikirim via ${json.data.channel} ke ${phone}. Berlaku ${Math.round(
            json.data.expires_in_sec / 60
          )} menit.`,
        });
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal meminta OTP." });
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/provider/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken() },
        body: JSON.stringify({ otp }),
      });
      const json = await res.json();
      if (json.success) {
        setStep("idle");
        setPhone("");
        setOtp("");
        setNote({ ok: true, text: `Login berhasil! Sesi tersimpan di database (${json.data.outlet_name ?? "merchant"}).` });
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Verifikasi gagal." });
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  const manualRefresh = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/provider/refresh", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken() },
      });
      const json = await res.json();
      if (json.success) {
        setNote({ ok: true, text: "Token berhasil di-refresh. Jadwal auto-refresh 6 jam dimulai ulang dari sekarang." });
        router.refresh();
      } else {
        setNote({ ok: false, text: json.error ?? "Gagal refresh token." });
        router.refresh();
      }
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  const deleteSession = async () => {
    if (!confirm("Hapus sesi GoPay dari database? Monitoring pembayaran akan berhenti sampai login ulang.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/provider/session", {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken() },
      });
      const json = await res.json();
      setNote(json.success ? { ok: true, text: "Sesi provider dihapus." } : { ok: false, text: json.error ?? "Gagal." });
      router.refresh();
    } catch {
      setNote({ ok: false, text: "Jaringan bermasalah." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="glass space-y-2 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Status Sesi</h2>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0 sm:gap-6">
            <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{r.label}</span>
            <span className={`text-right text-xs font-medium ${r.ok === false ? "text-[var(--color-danger)]" : r.ok === true ? "text-[var(--color-ok)]" : ""}`}>
              {r.value}
            </span>
          </div>
        ))}
        {hasSession && (
          <button type="button" disabled={busy} onClick={deleteSession} className="mt-2 text-[11px] uppercase tracking-wider text-[var(--color-danger)] hover:underline disabled:opacity-40">
            Hapus sesi provider
          </button>
        )}
      </div>

      <div className="glass space-y-3 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Aksi Cepat</h2>
        <p className="text-[11px] leading-snug text-[var(--color-muted)]">
          Refresh memperbarui access token memakai refresh token yang tersimpan — tanpa OTP. Jadwal auto-refresh 6 jam
          dihitung ulang dari waktu refresh ini.
        </p>
        <button type="button" disabled={busy || !hasSession} onClick={manualRefresh} className="btn-accent w-full rounded-xl py-2.5 disabled:opacity-40">
          {busy ? "Memproses…" : "Refresh Token Sekarang"}
        </button>
      </div>

      <div className="glass space-y-4 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Login via OTP</h2>

        {step !== "otp-sent" ? (
          <form onSubmit={requestOtp} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Nomor HP GoBiz/GoFood Merchant</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="contoh: 081234567890"
                className="input-dark"
                autoComplete="tel"
              />
              <span className="block text-[11px] text-[var(--color-muted)]">
                Kode OTP dikirim via SMS/WhatsApp oleh GoBiz. Maksimal 3 permintaan per 15 menit.
              </span>
            </label>
            {note && (
              <p className={`rounded-lg px-3 py-2 text-xs ${note.ok ? "bg-[rgba(34,197,94,0.12)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"}`}>
                {note.text}
              </p>
            )}
            <button disabled={busy || !phone.trim()} className="btn-accent w-full rounded-xl py-2.5">
              {busy ? "Meminta OTP…" : "Kirim Kode OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">Masukkan kode OTP</span>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="____"
                maxLength={8}
                className="input-dark text-center font-mono text-base tracking-[0.25em] sm:text-lg sm:tracking-[0.4em]"
                autoComplete="one-time-code"
              />
            </label>
            {note && (
              <p className={`rounded-lg px-3 py-2 text-xs ${note.ok ? "bg-[rgba(34,197,94,0.12)] text-[var(--color-ok)]" : "bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"}`}>
                {note.text}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setStep("idle");
                  setOtp("");
                  setNote(null);
                }}
                className="rounded-xl border border-white/10 py-2.5 text-xs hover:bg-white/5 disabled:opacity-40"
              >
                Ganti nomor
              </button>
              <button disabled={busy || otp.length < 3} className="btn-accent rounded-xl py-2.5">
                {busy ? "Memverifikasi…" : "Verifikasi & Simpan"}
              </button>
            </div>
          </form>
        )}

        {step !== "otp-sent" && pendingOtp.exists && (
          <p className="text-[11px] text-[var(--color-muted)]">
            Ada OTP aktif untuk {pendingOtp.maskedPhone} (sisa ~{pendingOtp.expiresInSec} dtk) dari perangkat lain.
          </p>
        )}
      </div>
    </>
  );
}
