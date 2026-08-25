import DbBrowser from "./DbBrowser.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Database" };

export default function DatabasePage() {
  return (
    <div className="bp-stagger space-y-4">
      <h1 className="text-lg font-bold">Database Browser</h1>
      <p className="text-xs text-[var(--color-muted)]">
        Akses baca terbatas pada kolom yang diizinkan — tanpa SQL mentah. Penghapusan hanya untuk entitas non-keuangan.
      </p>
      <DbBrowser />
    </div>
  );
}
