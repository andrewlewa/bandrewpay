"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./pay.css";
import { REDIRECT_DELAY_SECONDS, formatRemaining, formatRupiah, redirectCountdownText } from "@/lib/payments/pay-view";

type PayStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "CANCELLED";

type InitialState = {
  transactionId: string;
  status: PayStatus;
  amount: number;
  payableAmount: number;
  expiresAtMs: number;
  serverNowMs: number;
  redirectUrl: string | null;
  customerName: string | null;
  viewers: number;
};

type StatusResponse = {
  success: boolean;
  data?: {
    transaction_id: string;
    status: string;
    amount: number;
    expires_at: number;
    paid_at: number | null;
    redirect_url: string | null;
    server_now_ms: number;
  };
};

/* ===== Ikon inline (jalur lucide, tanpa CDN — aman CSP) ===== */
function Icon({ path, children }: { path?: string; children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path && <path d={path} />}
      {children}
    </svg>
  );
}
const IShieldCheck = () => (
  <Icon>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
const IClock = () => <Icon><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>;
const ILock = () => (
  <Icon>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
const IZap = () => (
  <Icon>
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </Icon>
);
const IXCircle = () => (
  <Icon>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </Icon>
);

export default function PaymentClient({ initial }: { initial: InitialState }) {
  const [status, setStatus] = useState<PayStatus>(initial.status);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(initial.redirectUrl);
  const [nowMs, setNowMs] = useState(() => Date.now() + (initial.serverNowMs - Date.now()));
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  /** Hitung mundur redirect 5 detik; null = belum mulai, 0 = navigasi. */
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  const offsetRef = useRef<number>(initial.serverNowMs - Date.now());
  const viewerIdRef = useRef<string>("");
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  const terminal = status !== "PENDING";
  const remainingMs = useMemo(
    () => (status === "PENDING" ? initial.expiresAtMs - nowMs : 0),
    [status, initial.expiresAtMs, nowMs]
  );
  const expired = status === "EXPIRED" || (status === "PENDING" && remainingMs <= 0);
  const failed = status === "FAILED" || status === "CANCELLED";
  const urgent = status === "PENDING" && !expired && remainingMs <= 60_000;

  const viewerId = useCallback((): string => {
    const key = `bp_viewer_${initial.transactionId}`;
    let id = window.sessionStorage.getItem(key) ?? "";
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
      window.sessionStorage.setItem(key, id);
    }
    return id;
  }, [initial.transactionId]);

  // --- Polling status (endpoint DB saja) + heartbeat lease ---
  useEffect(() => {
    if (terminal) {
      if (viewerIdRef.current) {
        navigator.sendBeacon?.("/api/payments/leave", JSON.stringify({ viewer_id: viewerIdRef.current }));
      }
      return;
    }
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/payments/${initial.transactionId}/status`, { cache: "no-store" });
        const json = (await res.json()) as StatusResponse;
        if (!stopped && json.success && json.data) {
          offsetRef.current = json.data.server_now_ms - Date.now();
          setNowMs(Date.now());
          const next = json.data.status.toUpperCase() as PayStatus;
          setStatus((prev) => (prev !== next ? next : prev));
          if (next === "PAID") setRedirectUrl(json.data.redirect_url ?? null);
        }
      } catch {
        /* jaringan flaky — coba lagi di tick berikutnya */
      }
    };

    const heartbeat = async () => {
      try {
        await fetch("/api/payments/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_id: initial.transactionId, viewer_id: viewerId() }),
        });
      } catch {
        /* heartbeat best-effort */
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        navigator.sendBeacon?.("/api/payments/leave", JSON.stringify({ viewer_id: viewerId() }));
      } else {
        void poll();
        void heartbeat();
      }
    };
    const onLeave = () => {
      navigator.sendBeacon?.("/api/payments/leave", JSON.stringify({ viewer_id: viewerId() }));
    };

    void heartbeat();
    const pollTimer = setInterval(poll, 5000);
    const hbTimer = setInterval(heartbeat, 10000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);

    return () => {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(hbTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [initial.transactionId, terminal, viewerId]);

  // --- Jam lokal + offset server ---
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- Animasi masuk kartu (hanya setelah hydrate, hindari flash SSR) ---
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setEntering(true);
    const t = setTimeout(() => setEntering(false), 900);
    return () => clearTimeout(t);
  }, []);

  // --- Efek tilt 3D (pointer halus + hormati reduced-motion) ---
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let rafId: number | null = null;
    let targetRX = 0, targetRY = 0, currentRX = 0, currentRY = 0;

    const animate = () => {
      currentRX += (targetRX - currentRX) * 0.12;
      currentRY += (targetRY - currentRY) * 0.12;
      card.style.transform = `rotateX(${currentRX}deg) rotateY(${currentRY}deg)`;
      if (Math.abs(targetRX - currentRX) > 0.01 || Math.abs(targetRY - currentRY) > 0.01) {
        rafId = requestAnimationFrame(animate);
      } else {
        rafId = null;
      }
    };
    const onEnter = () => card.classList.add("tilted");
    const onMove = (e: MouseEvent) => {
      if (!card.classList.contains("tilted")) return;
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      targetRY = x * 6;
      targetRX = -y * 5;
      if (!rafId) rafId = requestAnimationFrame(animate);
    };
    const onLeaveEl = () => {
      card.classList.remove("tilted");
      targetRX = 0;
      targetRY = 0;
      if (!rafId) rafId = requestAnimationFrame(animate);
      card.style.transform = "";
    };

    card.addEventListener("mouseenter", onEnter);
    card.addEventListener("mousemove", onMove);
    card.addEventListener("mouseleave", onLeaveEl);
    return () => {
      card.removeEventListener("mouseenter", onEnter);
      card.removeEventListener("mousemove", onMove);
      card.removeEventListener("mouseleave", onLeaveEl);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // --- Hover magnetis pada badge aman & frame QRIS ---
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const els = Array.from(root.querySelectorAll<HTMLElement>(".secure-badge, .qris-frame"));
    const handlers = els.map((el) => {
      const onMove = (e: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const strength = el.classList.contains("qris-frame") ? 0.05 : 0.2;
        el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      };
      const onLeave = () => {
        el.style.transform = "";
      };
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", onLeave);
      return { el, onMove, onLeave };
    });
    return () => {
      for (const h of handlers) {
        h.el.removeEventListener("mousemove", h.onMove);
        h.el.removeEventListener("mouseleave", h.onLeave);
      }
    };
  }, []);

  // --- JEDA 5 DETIK sebelum redirect ke redirect_url (dengan tampilan hitung mundur) ---
  useEffect(() => {
    if (status !== "PAID" || !redirectUrl) {
      setRedirectIn(null);
      return;
    }
    setRedirectIn(REDIRECT_DELAY_SECONDS);
  }, [status, redirectUrl]);

  useEffect(() => {
    if (redirectIn === null) return;
    if (redirectIn <= 0) {
      if (redirectUrl) window.location.href = redirectUrl;
      return;
    }
    const t = setTimeout(() => setRedirectIn((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [redirectIn, redirectUrl]);

  const manualCheck = async () => {
    if (checking || terminal) return;
    setChecking(true);
    setCheckNote(null);
    try {
      const res = await fetch(`/api/payments/${initial.transactionId}/check`, { method: "POST" });
      const json = await res.json();
      if (json.success && json.data) {
        offsetRef.current = json.data.server_now_ms - Date.now();
        const next = String(json.data.status).toUpperCase() as PayStatus;
        setStatus(next);
        if (next === "PAID") setRedirectUrl(json.data.redirect_url ?? null);
        // Pesan JUJUR per hasil pemeriksaan — jangan samakan throttle/error
        // dengan "belum ada pembayaran" (bug UX lama).
        const outcome = String(json.data.check_outcome ?? "");
        setCheckNote(
          next === "PAID"
            ? "Pembayaran terdeteksi!"
            : outcome === "throttled"
              ? "Baru saja diperiksa. Tunggu 3 detik lalu coba lagi."
              : outcome === "in_flight"
                ? "Pemeriksaan sebelumnya masih berjalan — tunggu sesaat."
                : outcome === "error"
                  ? "Gagal menghubungi provider pembayaran. Coba lagi sebentar."
                  : "Belum ada pembayaran masuk. Pastikan Anda menyelesaikan pembayaran di aplikasi."
        );
      } else {
        setCheckNote(json.error ?? "Pengecekan gagal. Coba lagi sebentar.");
      }
    } catch {
      setCheckNote("Jaringan bermasalah. Coba lagi.");
    } finally {
      setChecking(false);
    }
  };

  const copyAmount = async () => {
    try {
      await navigator.clipboard.writeText(String(initial.payableAmount));
      setCheckNote("Nominal disalin. Gunakan nominal persis saat membayar via QRIS.");
    } catch {
      /* clipboard bisa diblokir browser */
    }
  };

  const stateClass =
    status === "PAID" ? "success" : expired ? "expired" : failed ? "failed" : "";

  const progressPct =
    redirectIn === null ? 0 : ((REDIRECT_DELAY_SECONDS - Math.max(redirectIn, 0)) / REDIRECT_DELAY_SECONDS) * 100;

  return (
    <div ref={rootRef} className="bp-pay-root">
      {/* Latar sinematik */}
      <div className="bg-cinematic" aria-hidden="true">
        <div className="aurora aurora-1"></div>
        <div className="aurora aurora-2"></div>
        <div className="aurora aurora-3"></div>
        <div className="grid-overlay"></div>
        <div className="noise"></div>
      </div>
      <div className="light-blobs" aria-hidden="true">
        <span className="blob blob-1"></span>
        <span className="blob blob-2"></span>
        <span className="blob blob-3"></span>
        <span className="blob blob-4"></span>
      </div>

      <main className="payment-stage">
        <article ref={cardRef} className={`payment-card${entering ? " entering" : ""}`} tabIndex={-1}>
          <div className="card-border-glow" aria-hidden="true"></div>
          <div className="glass-reflection" aria-hidden="true"></div>

          {/* HEADER */}
          <header className="card-header">
            <div className="brand">
              <div className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 2.2 L19.5 5 V11.5 C19.5 16.4 16.2 20.5 12 21.8 C7.8 20.5 4.5 16.4 4.5 11.5 V5 Z" fill="url(#bpBrandGrad)" stroke="rgba(255,179,71,0.5)" strokeWidth="0.6" />
                  <path d="M8.5 12 L11 14.5 L15.5 9.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <defs>
                    <linearGradient id="bpBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ff9a3c" />
                      <stop offset="55%" stopColor="#ff7a00" />
                      <stop offset="100%" stopColor="#b34500" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="brand-text">
                <span className="brand-name">BandrewPay</span>
                <span className="brand-sub">Pembayaran QRIS Aman</span>
              </div>
            </div>
            <div className="secure-badge" aria-label="Koneksi pembayaran aman">
              <span className="secure-dot" aria-hidden="true"></span>
              <IShieldCheck />
              <span>Aman</span>
            </div>
          </header>

          {/* NOMINAL */}
          <section className="amount-block">
            <span className="amount-label">Total Pembayaran</span>
            <div className="amount-value">
              <button type="button" className="amount-copy" onClick={copyAmount} title="Klik untuk menyalin nominal">
                <span className="amount-num">{formatRupiah(initial.payableAmount)}</span>
              </button>
            </div>
            <p className="amount-hint">Selesaikan pembayaran dengan memindai QRIS di bawah</p>
            {initial.payableAmount !== initial.amount && (
              <p className="unique-code-note">Termasuk kode unik agar dana Anda tidak tertukar.</p>
            )}
          </section>

          {/* QRIS */}
          <section className="qris-section">
            <div className="qris-frame">
              <div className="qris-glow" aria-hidden="true"></div>
              <div className="qris-border-anim" aria-hidden="true"></div>
              <div className="qris-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/pay/${initial.transactionId}/qr.png`}
                  alt="Kode QRIS — pindai dengan aplikasi bank atau e-wallet"
                  className="qris-image"
                  width={220}
                  height={220}
                />
                <div className="scan-aura" aria-hidden="true"></div>
                {expired && (
                  <div className="expired-overlay show" aria-hidden="true">
                    <IClock />
                    <span>Kedaluwarsa</span>
                  </div>
                )}
              </div>
            </div>
            <div className="qris-label">
              <span className="qris-tag">QRIS</span>
              <span className="qris-supported">Didukung semua bank &amp; e-wallet Indonesia</span>
              {initial.customerName && <span className="customer-line">a.n. {initial.customerName}</span>}
            </div>
          </section>

          {/* STATUS */}
          <section className={`status-block ${stateClass}`} id="statusBlock">
            <div className="status-row">
              <span className="status-indicator" aria-hidden="true">
                <span className="status-pulse"></span>
              </span>
              <span className="status-text">
                {status === "PAID"
                  ? "Pembayaran Berhasil"
                  : expired
                      ? "QRIS Kedaluwarsa"
                    : failed
                      ? status === "CANCELLED"
                        ? "Dibatalkan"
                        : "Transaksi Gagal"
                      : "Menunggu Pembayaran"}
              </span>
            </div>
            <p className="status-hint">
              {status === "PAID"
                ? "Pembayaran Anda telah kami terima dan verifikasi."
                : expired
                    ? "Kode QRIS ini tidak berlaku lagi."
                  : failed
                    ? "Silakan hubungi merchant atau ulangi transaksi dengan invoice baru."
                    : "Buka aplikasi bank atau e-wallet, lalu pindai kode QRIS."}
            </p>
          </section>

          {/* TIMER + AKSI (hanya saat pending) */}
          {status === "PENDING" && !expired && (
            <>
              <section className={`timer-block${urgent ? " urgent" : ""}`} aria-label="Sisa waktu">
                <div className="timer-icon" aria-hidden="true"><IClock /></div>
                <div className="timer-content">
                  <span className="timer-label">QRIS berakhir dalam</span>
                  <span className="timer-value">{formatRemaining(remainingMs)}</span>
                </div>
              </section>
              <button onClick={manualCheck} disabled={checking} className="manual-check-btn" type="button">
                <IShieldCheck />
                <span>{checking ? "Memeriksa…" : "Saya Sudah Bayar — Cek Status"}</span>
              </button>
              {checkNote && <p className="check-note">{checkNote}</p>}
            </>
          )}

          {/* FOOTER */}
          <footer className="security-footer">
            <div className="security-left">
              <ILock />
              <span>Diamankan oleh BandrewPay</span>
            </div>
            <div className="security-meta">{initial.transactionId}</div>
          </footer>

          {/* STATE SUKSES */}
          <div className={`success-state${status === "PAID" ? " show" : ""}`} role="status" aria-live="polite" aria-hidden={status === "PAID" ? "false" : "true"}>
            <div className="success-glow" aria-hidden="true"></div>
            <svg className="success-check" viewBox="0 0 80 80" aria-hidden="true">
              <defs>
                <linearGradient id="bpSuccessGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffd194" />
                  <stop offset="50%" stopColor="#ffb347" />
                  <stop offset="100%" stopColor="#ff7a00" />
                </linearGradient>
              </defs>
              <circle cx="40" cy="40" r="36" className="success-circle" />
              <path d="M24 41 L35 52 L57 28" className="success-path" />
            </svg>
            <h2 className="success-title">Pembayaran Berhasil</h2>
            <p className="success-amount">{formatRupiah(initial.payableAmount)}</p>
            <p className="success-hint">Transaksi Anda telah selesai dengan aman.</p>
            <div className="success-receipt">
              <IShieldCheck />
              <span>ID: {initial.transactionId}</span>
            </div>
            {redirectUrl && (
              <>
                <p className="redirect-line">{redirectCountdownText(redirectIn)}</p>
                <div className="redirect-track" aria-hidden="true">
                  <div className="redirect-progress" style={{ width: `${progressPct}%` }}></div>
                </div>
              </>
            )}
          </div>

          {/* STATE KEDALUWARSA / GAGAL */}
          {(expired || failed) && (
            <div className="expired-state show" role="status" aria-live="polite" aria-hidden="false">
              <div className="expired-glow" aria-hidden="true"></div>
              <div className="expired-icon-wrap">{failed ? <IXCircle /> : <IClock />}</div>
              <h2 className="expired-title">
                {failed ? (status === "CANCELLED" ? "Dibatalkan" : "Transaksi Gagal") : "QRIS Kedaluwarsa"}
              </h2>
              <p className="expired-hint">
                {failed
                  ? "Transaksi ini tidak dapat dilanjutkan. Silakan hubungi merchant atau buat invoice baru."
                  : "Sesi pembayaran berakhir. Silakan buat transaksi baru dari halaman merchant."}
              </p>
            </div>
          )}
        </article>

        {/* Trust strip */}
        <aside className="trust-strip" aria-label="Jaminan keamanan">
          <div className="trust-item">
            <IShieldCheck />
            <span>Callback HMAC Tersigning</span>
          </div>
          <span className="trust-divider" aria-hidden="true"></span>
          <div className="trust-item">
            <ILock />
            <span>Enkripsi End-to-End</span>
          </div>
          <span className="trust-divider" aria-hidden="true"></span>
          <div className="trust-item">
            <IZap />
            <span>Verifikasi Instan</span>
          </div>
        </aside>
      </main>
    </div>
  );
}
