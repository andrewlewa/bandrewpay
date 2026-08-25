import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="glass max-w-md w-full p-8 text-center">
        <Image
          src="/logo.png"
          alt="BandrewPay"
          width={56}
          height={56}
          priority
          className="mx-auto mb-4 h-14 w-14 rounded-2xl object-contain"
        />
        <h1 className="text-2xl font-bold tracking-tight">BandrewPay</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Gateway pembayaran QRIS dengan verifikasi otomatis. Jika Anda diarahkan ke halaman ini,
          gunakan tautan pembayaran yang diberikan merchant (format <code>/pay/TRX-…</code>).
        </p>
        <Link href="/admin" className="btn-accent mt-6 inline-block rounded-xl px-5 py-2.5 text-sm">
          Masuk Dashboard Admin
        </Link>
      </div>
    </main>
  );
}
