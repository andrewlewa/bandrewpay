import { existsSync } from "node:fs";
import {
  listSettings,
  effectiveAppUrl,
  effectivePaymentTtlSeconds,
  effectiveCallbackTimeoutMs,
  effectiveMonitorPollIntervalMs,
  effectiveMonitorViewerLeaseMs,
  effectiveMonitorTickMs,
  getConfiguredQrisStatic,
  getConfiguredMerchantId,
} from "@/lib/config-store";
import SettingsForm from "./SettingsForm.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengaturan" };

export type SettingRow = {
  key: string;
  label: string;
  /** Nilai aman untuk ditampilkan (secret dimask). */
  display: string;
  /** Nilai untuk diisi ulang ke input (selalu string kosong untuk secret). */
  value: string;
  source: "settings" | "env" | "default" | "generated" | "unset";
};

type NumEff = { value: number; source: "settings" | "env" | "default" };

export default async function SettingsPage() {
  const qris = getConfiguredQrisStatic();
  const merchant = getConfiguredMerchantId();
  const appUrl = effectiveAppUrl();
  const ttl = effectivePaymentTtlSeconds() as NumEff;
  const cbTimeout = effectiveCallbackTimeoutMs() as NumEff;
  const pollMs = effectiveMonitorPollIntervalMs() as NumEff;
  const leaseMs = effectiveMonitorViewerLeaseMs() as NumEff;
  const tickMs = effectiveMonitorTickMs() as NumEff;

  const rows: SettingRow[] = [
    strRow("app_url", "App URL", appUrl.value || "(kosong)", appUrl.source),
    {
      key: "qris_static",
      label: "QRIS Statis",
      display: qris.value ? `${qris.value.slice(0, 24)}… (${qris.value.length} chars)` : "(belum diatur)",
      value: "",
      source: qris.value ? (qris.source as SettingRow["source"]) : "unset",
    },
    strRow("gopay_merchant_id", "GoPay Merchant ID", merchant.value || "(kosong)", merchant.source),
    numRow("payment_ttl_seconds", "TTL Pembayaran (detik)", ttl),
    numRow("callback_timeout_ms", "Timeout Callback (ms)", cbTimeout),
    numRow("monitor_poll_interval_ms", "Interval Poll Upstream (ms)", pollMs),
    numRow("monitor_viewer_lease_ms", "Lease Viewer (ms)", leaseMs),
    numRow("monitor_tick_ms", "Tick Koordinator (ms)", tickMs),
  ];

  const overrides = Object.fromEntries(
    listSettings().map((r) => [r.key, { updated_at: r.updated_at }] as const)
  );

  // Secret tidak pernah dikirim nilainya ke klien — hanya sumbernya.
  const secretInfo = {
    integration_secret: secretSource("integration_secret", overrides),
    session_secret: secretSource("session_secret", overrides),
  };

  const dbPath = process.env.DATABASE_PATH ?? "(default data/gateway.db)";
  const sessionFile = process.env.GOPAY_SESSION_FILE ?? ".GOPAY_SESI_JANGAN_DIHAPUS.json";

  return (
    <div className="bp-stagger space-y-4">
      <h1 className="text-lg font-bold">Pengaturan</h1>
      <p className="text-xs text-[var(--color-muted)]">
        Semua nilai dapat diubah dari dashboard dan langsung aktif tanpa restart. File{" "}
        <code>.env</code> hanya fallback/bootstrap — override dashboard selalu menang.
      </p>
      <SettingsForm rows={rows} overrides={overrides} secretInfo={secretInfo} />
      <div className="glass space-y-2 p-5 text-sm">
        <h2 className="font-semibold text-[var(--color-muted)]">Hanya via .env / file (baca-saja)</h2>
        <EnvOnly label="Database" value={dbPath} />
        <EnvOnly
          label="File sesi provider"
          value={`${sessionFile} ${existsSync(sessionFile) ? "✓ terimpor" : "— belum ada"}`}
          ok={existsSync(sessionFile)}
        />
      </div>
    </div>
  );
}

function strRow(key: string, label: string, value: string, source: string): SettingRow {
  return { key, label, display: value, value, source: source as SettingRow["source"] };
}

function numRow(key: string, label: string, e: NumEff): SettingRow {
  return { key, label, display: String(e.value), value: "", source: e.source };
}

function secretSource(key: "integration_secret" | "session_secret", overrides: Record<string, unknown>): string {
  if (key in overrides) return "settings";
  if (key === "integration_secret") return process.env.INTEGRATION_SECRET?.trim() ? "env" : "generated";
  return process.env.SESSION_SECRET?.trim() ? "env" : "generated";
}

function EnvOnly({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-white/5 pb-1.5 last:border-0">
      <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
      <span className={`text-right text-xs font-medium ${ok === false ? "text-[var(--color-danger)]" : ""}`}>{value}</span>
    </div>
  );
}
