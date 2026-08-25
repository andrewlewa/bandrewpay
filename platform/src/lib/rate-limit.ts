/**
 * Rate limiter in-memory (sliding window) untuk hot path HTTP.
 * Cakupan: single instance — sesuai model deployment SQLite.
 * Catatan keamanan persisten (login attempts, audit) tetap di DB.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

export type RateResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function checkRate(key: string, limit: number, windowMs: number, nowMs = Date.now()): RateResult {
  pruneIfNeeded(nowMs);
  const bucket = buckets.get(key) ?? { hits: [] };
  const cutoff = nowMs - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0]!;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)),
    };
  }
  bucket.hits.push(nowMs);
  buckets.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

export function resetRate(key: string): void {
  buckets.delete(key);
}

function pruneIfNeeded(nowMs: number): void {
  if (nowMs - lastPrune < 60_000) return;
  lastPrune = nowMs;
  for (const [key, bucket] of buckets) {
    const maxHit = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (nowMs - maxHit > 10 * 60_000 || bucket.hits.length === 0) {
      buckets.delete(key);
    }
  }
}

/** Ekstrak IP klien dari request headers (tanpa mempercayai XFF buta). */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? null;
}
