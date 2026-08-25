import { z } from "zod";
import { getEnv } from "../env.ts";
import { effectiveAppUrl, effectivePaymentTtlSeconds, getConfiguredQrisStatic } from "../config-store.ts";
import { generateDynamicQris } from "./qris.ts";
import {
  insertTransaction,
  findPendingByOrderId,
  IdempotentConflictError,
  getTransaction,
  type Transaction,
} from "./transactions-repo.ts";
import { verifyTransaction, type VerifyOutcome } from "./verifier.ts";
import { enqueueCallback } from "../callbacks/dispatcher.ts";
import { isPayableAmountActive } from "./transactions-repo.ts";
import { getIntegrationApp } from "../integrations.ts";

/** Skema request integrasi (Paymenter -> gateway). Dipakai juga oleh route handler. */
/** https wajib, kecuali host lokal untuk integrasi/dev. */
function isAcceptableHttpUrl(u: string): boolean {
  return u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
}

export const createPaymentSchema = z.object({
  order_id: z
    .string()
    .trim()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/, "order_id hanya boleh berisi [A-Za-z0-9._:-]"),
  amount: z.coerce.number().int().positive().max(50_000_000),
  currency: z.literal("IDR").default("IDR"),
  customer_name: z.string().trim().max(128).optional(),
  customer_email: z.email().max(254).optional(),
  callback_url: z.url().max(512).refine(isAcceptableHttpUrl, "callback_url harus https").optional(),
  redirect_url: z.url().max(512).refine(isAcceptableHttpUrl, "redirect_url harus https").optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export function appBaseUrl(): string {
  return effectiveAppUrl().value;
}

export function buildPaymentUrl(transactionId: string): string {
  return `${appBaseUrl()}/pay/${transactionId}`;
}

export type CreatePaymentResult =
  | { ok: true; transaction: Transaction; reused: boolean }
  | { ok: false; error: string };

/**
 * Pilih nominal unik = amount + kode acak 1..100 sehingga tidak ada dua
 * transaksi PENDING aktif dengan nominal QRIS sama. Ini menutup celah
 * salah-klaim: si A vs si B dengan nominal dasar identik tidak mungkin
 * lagi tertukar di upstream karena nominal QRIS-nya berbeda.
 */
function pickUniquePayable(baseAmount: number): number | null {
  for (let attempt = 0; attempt < 250; attempt++) {
    const candidate = baseAmount + 1 + Math.floor(Math.random() * 100);
    if (!isPayableAmountActive(candidate)) return candidate;
  }
  return null;
}

/**
 * Buat transaksi pembayaran (idempoten terhadap order_id yang masih PENDING).
 * QRIS payload disimpan di DB — tidak pernah ada file artifact di disk.
 */
export async function createPayment(
  input: CreatePaymentInput,
  integrationId: string | null
): Promise<CreatePaymentResult> {
  // Idempotensi: order dengan PENDING existing -> kembalikan yang sama.
  const pending = findPendingByOrderId(input.order_id);
  if (pending && pending.expires_at > Date.now()) {
    return { ok: true, transaction: pending, reused: true };
  }

  const template = getConfiguredQrisStatic().value;
  if (!template) {
    return { ok: false, error: "QRIS statis belum dikonfigurasi (Settings atau QRIS_STATIC)" };
  }

  const payableAmount = pickUniquePayable(input.amount);
  if (payableAmount === null) {
    return {
      ok: false,
      error: "Semua kode unik untuk nominal ini sedang terpakai — coba lagi sesaat lagi",
    };
  }

  const qrisPayload = generateDynamicQris(template, payableAmount);
  if (!qrisPayload || !qrisPayload.startsWith("0002")) {
    return { ok: false, error: "Template QRIS tidak valid" };
  }

  const ttlMs = effectivePaymentTtlSeconds().value * 1000;
  // Default callback/redirect per aplikasi (Admin > Aplikasi); payload menang.
  const app = integrationId ? getIntegrationApp(integrationId) : null;
  try {
    const tx = insertTransaction({
      order_id: input.order_id,
      amount: input.amount,
      payable_amount: payableAmount,
      qris_payload: qrisPayload,
      integration_id: integrationId ?? null,
      callback_url: input.callback_url ?? app?.callback_url ?? null,
      redirect_url: input.redirect_url ?? app?.redirect_url ?? null,
      customer_name: input.customer_name ?? null,
      customer_email: input.customer_email ?? null,
      expires_at: Date.now() + ttlMs,
    });
    return { ok: true, transaction: tx, reused: false };
  } catch (err) {
    if (err instanceof IdempotentConflictError) {
      const existing = getTransaction(err.existingId);
      if (existing && existing.status === "PENDING") {
        return { ok: true, transaction: existing, reused: true };
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : "gagal membuat transaksi" };
  }
}

/**
 * Jalankan satu verifikasi untuk transaksi (manual check / coordinator),
 * lalu antrekan callback bila hasilnya PAID. Single-flight per proses:
 * N permintaan bersamaan untuk trx sama = maksimal satu panggilan upstream.
 */
const inFlight = new Map<string, Promise<string>>();

export async function verifyAndNotify(
  transactionId: string,
  opts?: { force?: boolean }
): Promise<{ outcome: string; transaction?: Transaction }> {
  const existing = inFlight.get(transactionId);
  if (existing) {
    await existing.catch(() => undefined);
    return { outcome: "IN_FLIGHT", transaction: getTransaction(transactionId) ?? undefined };
  }

  const promise = (async () => {
    const result = await verifyTransaction(transactionId, opts);
    if (result.outcome === "MATCHED") {
      await enqueueCallback(result.transaction);
    }
    return result.outcome as VerifyOutcome["outcome"] & string;
  })();

  inFlight.set(transactionId, promise);
  try {
    const outcome = await promise;
    return { outcome, transaction: getTransaction(transactionId) ?? undefined };
  } finally {
    inFlight.delete(transactionId);
  }
}
