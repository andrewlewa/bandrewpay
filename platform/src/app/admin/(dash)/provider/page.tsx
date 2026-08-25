import { loadSession, isExpired } from "@/lib/payments/gojek";
import { getPendingMeta } from "@/lib/payments/provider-login";
import {
  getRefreshStatus,
  nextRefreshAtMs,
  PROVIDER_REFRESH_INTERVAL_MS,
} from "@/lib/payments/provider-refresh";
import ProviderStatusCard from "./ProviderStatusCard.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sesi GoPay" };

function mask(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;
  return `+62${"*".repeat(Math.max(digits.length - 6, 3))}${digits.slice(-4)}`;
}

export default async function ProviderPage() {
  const session = loadSession();
  const pending = getPendingMeta();
  const rows: Array<{ label: string; value: string; ok?: boolean }> = [];

  rows.push({
    label: "Sesi tersimpan",
    value: session?.access_token || session?.refresh_token ? "Ya — di database (provider_session)" : "Belum ada",
    ok: !!(session?.access_token || session?.refresh_token),
  });
  rows.push({
    label: "Status token",
    value: session ? (isExpired(session) ? "Kedaluwarsa / perlu refresh" : "Aktif") : "—",
    ok: session ? !isExpired(session) : false,
  });
  rows.push({ label: "Nomor HP", value: mask(session?.phone_number ?? null) ?? "—" });
  rows.push({ label: "Outlet", value: session?.outlet_name ?? "—" });
  rows.push({ label: "Merchant ID", value: session?.merchant_id ?? "—" });
  rows.push({
    label: "Terakhir diperbarui",
    value: session?.updated_at ? new Date(session.updated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "—",
  });
  rows.push({
    label: "Kedaluwarsa (asumsi +24j)",
    value: session?.expires_at ? new Date(session.expires_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "—",
  });

  // --- Auto-refresh (6 jam, restart-safe) ---
  const refreshStatus = getRefreshStatus();
  const nextAt = nextRefreshAtMs();
  rows.push({
    label: `Auto-refresh (${PROVIDER_REFRESH_INTERVAL_MS / 3_600_000} jam)`,
    value: nextAt ? `berikutnya ${new Date(nextAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}` : "—",
    ok: true,
  });
  if (refreshStatus) {
    const when = new Date(refreshStatus.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    rows.push({
      label: "Auto-refresh terakhir",
      value: refreshStatus.ok
        ? `sukses · ${when}`
        : `GAGAL · ${when}${refreshStatus.error ? ` (${refreshStatus.error})` : ""} — login ulang manual di bawah`,
      ok: refreshStatus.ok,
    });
  }

  return (
    <div className="bp-stagger space-y-4">
      <h1 className="text-lg font-bold">Sesi GoPay / GoFood Merchant</h1>
      <p className="text-xs text-[var(--color-muted)]">
        Sesi (bearer/refresh token) disimpan di dalam database gateway (<code>provider_session</code>) — bukan file
        plaintext. Login ulang via OTP kapan pun dari halaman ini. Token tidak pernah ditampilkan.
      </p>
      <ProviderStatusCard
        rows={rows}
        hasSession={!!(session?.access_token || session?.refresh_token)}
        pendingOtp={pending}
      />
    </div>
  );
}
