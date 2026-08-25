import crypto from "node:crypto";

/** ID transaksi: TRX- + 16 hex uppercase dari CSPRNG (bukan Math.random). */
export function newTransactionId(): string {
  return "TRX-" + crypto.randomBytes(8).toString("hex").toUpperCase();
}

/** UUID v4 untuk event/delivery/viewer id. */
export function newUuid(): string {
  return crypto.randomUUID();
}

/** Token sesi/viewer acak dengan panjang entropi cukup. */
export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** SHA-256 hex dari string — dipakai untuk hash nonce & body. */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Verifikasi string rahasia dengan perbandingan constant-time
 * (perbaikan atas `===` pada implementasi lama).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
