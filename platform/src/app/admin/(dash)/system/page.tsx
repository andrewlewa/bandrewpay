import { coordinatorStatus } from "@/lib/monitor/coordinator";
import { loadSession, isExpired } from "@/lib/payments/gojek";
import { getDb } from "@/db/index";
import { dateTime } from "../format.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sistem" };

function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  return `${phone.slice(0, 4)}••••${phone.slice(-2)}`;
}

export default function SystemPage() {
  const monitor = coordinatorStatus();
  const session = loadSession();
  const db = getDb();

  let dbFile = "tidak diketahui";
  try {
    const row = db.pragma("database_list") as Array<{ name: string; file: string }>;
    dbFile = row.find((r) => r.name === "main")?.file ?? dbFile;
  } catch { /* pragma gagal */ }

  return (
    <div className="bp-stagger space-y-4">
      <h1 className="text-lg font-bold">Status Sistem</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass space-y-2 p-5 text-sm">
          <h2 className="font-semibold text-[var(--color-muted)]">Monitor Coordinator</h2>
          <Row label="Status" value={monitor.running ? "Aktif (interval)" : "Mati — restart server!"} />
          <Row label="Mulai pada" value={monitor.startedAt ? dateTime(monitor.startedAt) : "—"} />
          <p className="pt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Satu poller upstream per transaksi aktif per interval, terlepas dari jumlah viewer halaman bayar.
            Browser hanya mendaftarkan lease heartbeat ke DB.
          </p>
        </div>

        <div className="glass space-y-2 p-5 text-sm">
          <h2 className="font-semibold text-[var(--color-muted)]">Sesi Provider GoBiz</h2>
          <Row label="Sesi dimuat" value={session?.access_token ? "Ya" : "Tidak — jalankan import-session"} />
          <Row label="Kedaluwarsa (asumsi +24j)" value={session?.expires_at ? dateTime(new Date(session.expires_at).getTime()) : "—"} />
          <Row label="Status" value={session ? (isExpired(session) ? "Expired/perlu refresh" : "Valid") : "—"} />
          <Row label="Telepon (mask)" value={maskPhone(session?.phone_number ?? null)} />
          <p className="pt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Token disimpan di SQLite (file chmod 600), bukan plaintext JSON. Tidak pernah diekspos di UI.
          </p>
        </div>

        <div className="glass space-y-2 p-5 text-sm lg:col-span-2">
          <h2 className="font-semibold text-[var(--color-muted)]">Database</h2>
          <Row label="File" value={dbFile} mono small />
          <Row label="Mode journal" value={String((db.pragma("journal_mode", { simple: true }) as unknown))} />
          <Row label="Foreign keys" value={String(db.pragma("foreign_keys", { simple: true }))} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0 sm:gap-6">
      <span className="shrink-0 text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${small ? "break-all text-right text-[11px]" : "text-right"} text-xs font-medium`}>{value}</span>
    </div>
  );
}
