"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/admin", label: "Ringkasan", icon: <IconGrid /> },
  { href: "/admin/transactions", label: "Transaksi", icon: <IconList /> },
  { href: "/admin/payments/new", label: "Buat Pembayaran", icon: <IconPlus /> },
  { href: "/admin/callbacks", label: "Callbacks", icon: <IconSend /> },
  { href: "/admin/provider", label: "Sesi GoPay", icon: <IconPhone /> },
  { href: "/admin/apps", label: "Aplikasi", icon: <IconApps /> },
  { href: "/admin/security", label: "Keamanan", icon: <IconShield /> },
  { href: "/admin/database", label: "Database", icon: <IconDb /> },
  { href: "/admin/settings", label: "Pengaturan", icon: <IconSliders /> },
  { href: "/admin/system", label: "Sistem", icon: <IconCpu /> },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminSidebar({
  username,
  role,
}: {
  username: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Tutup drawer setiap pindah halaman.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Saat drawer terbuka: kunci scroll body + tutup dengan Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.push("/admin/login");
    } finally {
      setBusy(false);
    }
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {LINKS.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-[rgba(249,115,22,0.14)] font-medium text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className={active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}>
              {l.icon}
            </span>
            {l.label}
          </Link>        );
      })}
    </nav>
  );

  const userBlock = (
    <div className="border-t border-white/10 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-[var(--color-muted)]">
          {username}{" "}
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase">{role}</span>
        </span>
        <button onClick={logout} disabled={busy} className="btn-ghost rounded-lg px-3 py-1.5 text-sm">
          {busy ? "…" : "Keluar"}
        </button>
      </div>
    </div>
  );

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5 px-5 pb-4 pt-5 font-bold">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg object-contain" />
      BandrewPay
    </Link>
  );

  return (
    <>
      {/* Sidebar desktop */}
      <aside className="bp-aside-enter sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-white/10 bg-[rgba(11,15,26,0.7)] backdrop-blur lg:flex">
        {brand}
        {nav}
        {userBlock}
      </aside>

      {/* Topbar mobile - FIXED setinggi penuh layar (layout memberi pt-14 pada konten) */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-white/10 bg-[rgba(11,15,26,0.9)] px-3 backdrop-blur lg:hidden">
        <button
          aria-label="Buka menu"
          onClick={() => setOpen(true)}
          className="btn-ghost rounded-lg p-2"
        >
          <IconMenu />
        </button>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-bold">BandrewPay</span>
          <span className="truncate text-xs text-[var(--color-muted)]">
            · {LINKS.find((l) => isActive(pathname, l.href))?.label ?? "Admin"}
          </span>
        </div>
      </header>

      {/* Drawer mobile - SELALU ter-mount supaya buka/tutup ter-animate halus */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${open ? "" : "pointer-events-none"}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <button
          aria-label="Tutup menu"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ease-out ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          className={`absolute inset-y-0 left-0 flex w-[17rem] max-w-[86vw] flex-col border-r border-white/10 bg-[#0b101a] shadow-2xl transition-transform duration-[340ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
            open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
          }`}
        >
          <div className="flex items-start justify-between pr-3">
            {brand}
            <button
              aria-label="Tutup menu"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              className="btn-ghost mt-4 rounded-lg p-2"
            >
              <IconX />
            </button>
          </div>
          {nav}
          {userBlock}
        </div>
      </div>
    </>
  );
}

function IconX() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconList() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="0.8" fill="currentColor" />
      <circle cx="4" cy="12" r="0.8" fill="currentColor" />
      <circle cx="4" cy="18" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3L10 14M21 3l-7 18-4-9-9-4 20-5z" />
    </svg>
  );
}

function IconDb() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5V12c0 1.66 3.58 3 8 3s8-1.34 8-3V5.5M4 12v6.5c0 1.66 3.58 3 8 3s8-1.34 8-3V12" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    </svg>
  );
}

function IconApps() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="17" r="2" />
    </svg>
  );
}

function IconCpu() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}
