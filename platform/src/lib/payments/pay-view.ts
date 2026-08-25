/**
 * Helper tampilan murni untuk halaman bayar (/pay) — mudah di-unit-test.
 * Dipakai PaymentClient; TIDAK boleh mengandung kode browser-only.
 */

/** Jeda (detik) sebelum buyer diarahkan ke redirect_url setelah PAID. */
export const REDIRECT_DELAY_SECONDS = 5;

/** Format rupiah gaya platform: Rp125.000 (tanpa desimal; NBSP dinormalisasi). */
export function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 })
    .format(n)
    .replace(/\u00A0/g, " ");
}

/** Sisa waktu ms -> "MM:SS" (00:00 bila habis/negatif). */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Teks hitung-mundur redirect; null bila belum mulai. */
export function redirectCountdownText(secondsLeft: number | null): string | null {
  if (secondsLeft === null) return null;
  if (secondsLeft <= 0) return "Mengarahkan…";
  return `Anda akan diarahkan dalam ${secondsLeft} detik…`;
}
