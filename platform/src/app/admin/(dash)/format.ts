export function rupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);
}

export function dateTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}
