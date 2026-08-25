import { listBlocks } from "@/lib/auth/ip-guard";
import SecurityManager from "./SecurityManager.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Keamanan" };

const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "permanen";

export default async function SecurityPage() {
  const blocks = listBlocks();

  return (
    <div className="bp-stagger space-y-4">
      <h1 className="text-lg font-bold">Keamanan Login</h1>
      <p className="text-xs text-[var(--color-muted)]">
        Perlindungan halaman login: rate limit 10 percobaan / 5 menit per IP, kunci akun setelah kegagalan
        berulang, dan <b>blokir otomatis PERMANEN</b> IP yang gagal login 3 kali (berturut-turut sejak sukses terakhir). Blokir manual di bawah
        berlaku juga untuk halaman login.
      </p>
      <SecurityManager
        initial={blocks.map((b) => ({
          ip: b.ip,
          reason: b.reason,
          blocked_at: fmt(b.blocked_at),
          expires: fmt(b.expires_at),
          active: b.expires_at === null || b.expires_at > Date.now(),
        }))}
      />
    </div>
  );
}
