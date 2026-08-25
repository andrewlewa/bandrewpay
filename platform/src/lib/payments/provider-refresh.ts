/**
 * Auto-refresh sesi provider tiap 6 jam — RESTART-SAFE.
 *
 * Anchor waktu adalah `updated_at` sesi di SQLite (diperbarui setiap kali
 * login OTP atau refresh sukses), jadi tidak ada timer yang perlu diingat:
 * saat server nyala, kita hanya mengecek jam sekarang vs anchor. Kalau sudah
 * lewat 6 jam -> langsung refresh di boot.
 *
 * Jika refresh gagal (mis. refresh_token dicabut upstream), statusnya dicatat
 * ke settings dan ditampilkan di Admin > Sesi GoPay -> operator login ulang
 * manual via dashboard (OTP).
 */

import { getSetting, setSetting } from "../config-store.ts";
import { logAudit } from "../audit.ts";
import { loadSession, refreshSession } from "./gojek.ts";

export const PROVIDER_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type ProviderRefreshStatus = { ok: boolean; at: string; error?: string };

const STATUS_KEY = "provider_refresh_status";

export function getRefreshStatus(): ProviderRefreshStatus | null {
  const raw = getSetting<ProviderRefreshStatus>(STATUS_KEY);
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

/** Catat hasil refresh (auto maupun manual) ke settings untuk dashboard. */
export function recordRefreshStatus(ok: boolean, error?: string): void {
  const status: ProviderRefreshStatus = ok
    ? { ok: true, at: new Date().toISOString() }
    : { ok: false, at: new Date().toISOString(), error };
  setSetting(STATUS_KEY, status);
}

/** Jatuh tempo refresh = 6 jam sejak updated_at sesi (wall clock, restart-safe). */
export function isRefreshDue(nowMs = Date.now()): boolean {
  const s = loadSession();
  if (!s?.refresh_token) return false;
  const anchorMs = Date.parse(s.updated_at ?? "");
  if (!Number.isFinite(anchorMs)) return true; // tanpa anchor valid -> anggap perlu refresh
  return nowMs - anchorMs >= PROVIDER_REFRESH_INTERVAL_MS;
}

/** Waktu refresh berikutnya (ms epoch) atau null jika tidak bisa dihitung. */
export function nextRefreshAtMs(): number | null {
  const s = loadSession();
  if (!s?.refresh_token || !s.updated_at) return null;
  const anchorMs = Date.parse(s.updated_at);
  return Number.isFinite(anchorMs) ? anchorMs + PROVIDER_REFRESH_INTERVAL_MS : null;
}

/**
 * Jalankan refresh HANYA jika jatuh tempo. Dipanggil saat boot dan dari timer
 * periodik. Tidak pernah melempar — hasil selalu dicatat ke settings.
 */
export async function runDueProviderRefresh(actor = "system"): Promise<{ ran: boolean; ok: boolean; error?: string }> {
  if (!isRefreshDue()) return { ran: false, ok: true };
  try {
    const refreshed = await refreshSession();
    if (refreshed) {
      recordRefreshStatus(true);
      logAudit({ actor, action: "provider.refresh.auto", entityType: "provider_session", entityId: "gopay" });
      return { ran: true, ok: true };
    }
    const error = "refresh_session_returned_null";
    recordRefreshStatus(false, error);
    logAudit({ actor, action: "provider.refresh.failed", entityType: "provider_session", entityId: "gopay" });
    console.error("[provider] auto-refresh gagal — login ulang manual via Admin > Sesi GoPay.");
    return { ran: true, ok: false, error };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    recordRefreshStatus(false, error);
    logAudit({ actor, action: "provider.refresh.failed", entityType: "provider_session", entityId: "gopay" });
    console.error("[provider] auto-refresh error:", error);
    return { ran: true, ok: false, error };
  }
}

// --- Scheduler in-process (singleton per proses, aman terhadap HMR/dev) ---

const g = globalThis as unknown as { __bpProvRefresher?: ReturnType<typeof setInterval> };

export function startProviderRefreshJob(): void {
  if (g.__bpProvRefresher) return;
  // Cek segera saat boot: kalau server lama mati melewati batas 6 jam,
  // refresh dijalankan sekarang juga.
  void runDueProviderRefresh().catch((err) => console.error("[provider] boot refresh error:", err));
  // Cek berkala tiap 15 menit; refresh benar-benar terjadi hanya saat jatuh tempo.
  const timer = setInterval(() => {
    void runDueProviderRefresh().catch((err) => console.error("[provider] periodic refresh error:", err));
  }, 15 * 60_000);
  if (typeof timer.unref === "function") timer.unref();
  g.__bpProvRefresher = timer;
  console.info(`[provider] auto-refresh job aktif (interval ${PROVIDER_REFRESH_INTERVAL_MS / 3_600_000}j, restart-safe)`);
}

export function stopProviderRefreshJob(): void {
  if (g.__bpProvRefresher) clearInterval(g.__bpProvRefresher);
  g.__bpProvRefresher = undefined;
}
