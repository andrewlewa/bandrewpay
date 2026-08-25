import { listIntegrationApps } from "@/lib/integrations";
import AppsManager from "./AppsManager.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aplikasi" };

function mask(secret: string): string {
  if (!secret) return "(tidak tersimpan)";
  return `${secret.slice(0, 4)}${"*".repeat(Math.max(secret.length - 8, 6))}${secret.slice(-4)}`;
}

export default async function AppsPage() {
  const apps = listIntegrationApps().map((a) => ({
    id: a.id,
    label: a.label,
    secret_masked: mask(a.secret),
    callback_url: a.callback_url,
    redirect_url: a.redirect_url,
    active: a.active,
    created_at: a.created_at,
    last_used_at: a.last_used_at,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Aplikasi Integrasi</h1>
      <p className="text-xs text-[var(--color-muted)]">
        Daftarkan setiap platform toko di sini. Setiap aplikasi punya <b>secret sendiri</b> — request API yang menyertakan
        header <code>X-BP-Key: &lt;ID&gt;</code> diverifikasi dengan secret aplikasi tersebut, dan callback ke aplikasi itu
        dikirim dengan secret yang sama. Secret lama dari <code>.env</code> tetap jalan sebagai fallback (tanpa X-BP-Key).
      </p>
      <AppsManager initial={apps} />
    </div>
  );
}
