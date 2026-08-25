/**
 * Mesin status transaksi. Semua perubahan status WAJIB lewat transitionTransaction()
 * (compare-and-set) — tidak ada jalur tulis langsung ke kolom status.
 */

export const TRANSACTION_STATUSES = ["PENDING", "PAID", "EXPIRED", "FAILED", "CANCELLED"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export function isTerminalStatus(status: TransactionStatus): boolean {
  return status !== "PENDING";
}

const ALLOWED: Record<TransactionStatus, readonly TransactionStatus[]> = {
  PENDING: ["PAID", "EXPIRED", "FAILED", "CANCELLED"],
  PAID: [],
  EXPIRED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitions(from: TransactionStatus): readonly TransactionStatus[] {
  return ALLOWED[from];
}
