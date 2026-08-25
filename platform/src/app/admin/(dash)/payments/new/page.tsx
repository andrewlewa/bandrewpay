import CreatePaymentForm from "./CreatePaymentForm.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buat Pembayaran" };

export default function NewPaymentPage() {
  return (
    <div className="bp-stagger mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">Buat Pembayaran Manual</h1>
      <p className="text-sm text-[var(--color-muted)]">
        Buat transaksi QRIS langsung dari dashboard tanpa lewat integrasi. QRIS dibatalkan otomatis
        saat kedaluwarsa; pembayaran dideteksi oleh monitor server seperti biasa.
      </p>
      <CreatePaymentForm />
    </div>
  );
}
