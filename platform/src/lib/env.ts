import { z } from "zod";

/**
 * Validasi environment saat runtime (lazy — aman untuk `next build`).
 * Secret yang tidak diset di env akan difallback dari tabel settings
 * (nilai auto-generated pertama kali), lihat src/lib/config-store.ts.
 */
const schema = z.object({
  APP_URL: z.url().default("http://localhost:4100"),
  DATABASE_PATH: z.string().default("./data/gateway.db"),
  GOPAY_MERCHANT_ID: z.string().default(""),
  GOPAY_SESSION_FILE: z.string().default(""),
  QRIS_STATIC: z.string().default(""),
  PAYMENT_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
  CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  MONITOR_POLL_INTERVAL_MS: z.coerce.number().int().min(4000).max(300000).default(8000),
  MONITOR_VIEWER_LEASE_MS: z.coerce.number().int().min(8000).max(120000).default(25000),
  MONITOR_TICK_MS: z.coerce.number().int().min(1000).max(60000).default(4000),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Environment tidak valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  cached = parsed.data;
  return cached;
}

/** Dipanggil test untuk menghapus cache antar kasus. */
export function resetEnvCache(): void {
  cached = null;
}
