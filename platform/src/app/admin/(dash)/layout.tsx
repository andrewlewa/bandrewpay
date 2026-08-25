import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/admin-guard";
import AdminSidebar from "./AdminSidebar.tsx";
import RouteTransition from "./RouteTransition.tsx";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();
  // /admin/login punya layout sendiri (publik); layout ini hanya untuk halaman terproteksi.
  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="glass p-6 text-sm text-[var(--color-muted)]">
          Sesi tidak valid. <Link href="/admin/login" className="text-[var(--color-accent)] underline">Masuk ulang</Link>.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:flex">
      <AdminSidebar username={session.username} role={session.role} />
      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
          <RouteTransition>{children}</RouteTransition>
        </main>
        <footer className="border-t border-white/5 py-4 text-center text-xs text-[var(--color-muted)]">
          BandrewPay Gateway · data tersimpan lokal (SQLite)
        </footer>
      </div>
    </div>
  );
}
