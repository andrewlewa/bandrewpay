import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireAdminSession } from "@/lib/auth/admin-guard";
import { isIpBlocked } from "@/lib/auth/ip-guard";
import { clientIp } from "@/lib/rate-limit";
import LoginForm from "./LoginForm.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Login Admin" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const session = await requireAdminSession();
  if (session) redirect("/admin");

  const h = await headers();
  const ip = clientIp(new Headers(h));
  const blocked = isIpBlocked(ip);
  if (blocked) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="glass w-full max-w-sm p-6 text-center text-sm sm:p-8">
          <h1 className="text-xl font-bold text-[var(--color-danger)]">Akses Diblokir</h1>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            IP <code>{ip ?? "?"}</code> diblokir: {blocked.reason}
            {blocked.expires_at
              ? ` — berakhir ${new Date(blocked.expires_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}.`
              : " (permanen — hubungi operator)."}
          </p>
        </div>
      </main>
    );
  }

  const { err } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(249,115,22,0.14)] text-2xl">
            ⚡
          </span>
          <h1 className="text-xl font-bold">Masuk Dashboard</h1>
          <p className="mt-1 text-xs text-[var(--color-muted)]">BandrewPay Admin</p>
        </div>
        {err === "1" && (
          <p className="mb-4 rounded-lg bg-[rgba(239,68,68,0.12)] px-3 py-2 text-xs text-[var(--color-danger)]">
            Login gagal. Periksa username/password, atau akses Anda dibatasi.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
