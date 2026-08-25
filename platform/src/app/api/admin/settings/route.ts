import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import {
  setSetting,
  deleteSetting,
  listSettings,
  hasExplicitIntegrationSecret,
  effectiveAppUrl,
  effectivePaymentTtlSeconds,
  effectiveCallbackTimeoutMs,
  effectiveMonitorPollIntervalMs,
  effectiveMonitorViewerLeaseMs,
  effectiveMonitorTickMs,
  normalizeGoPayMerchantId,
} from "@/lib/config-store";

import { validateQrisChecksum } from "@/lib/payments/qris";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kunci settings yang bisa diubah dari dashboard. Env hanya fallback. */
const EDITABLE_KEYS = [
  "qris_static",
  "gopay_merchant_id",
  "integration_secret",
  "session_secret",
  "app_url",
  "payment_ttl_seconds",
  "callback_timeout_ms",
  "monitor_poll_interval_ms",
  "monitor_viewer_lease_ms",
  "monitor_tick_ms",
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];

const NUMBER_BOUNDS: Partial<Record<EditableKey, { min: number; max: number }>> = {
  payment_ttl_seconds: { min: 30, max: 86400 },
  callback_timeout_ms: { min: 1000, max: 60000 },
  monitor_poll_interval_ms: { min: 4000, max: 300000 },
  monitor_viewer_lease_ms: { min: 8000, max: 120000 },
  monitor_tick_ms: { min: 1000, max: 60000 },
};

function redactValue(key: string, value: string): string {
  if (/secret/.test(key) && value) {
    return `${value.slice(0, 4)}${"*".repeat(Math.max(value.length - 8, 0))}${value.slice(0, 4)}`;
  }
  if (key === "qris_static" && value.length > 40) {
    return `${value.slice(0, 32)}…(${value.length} chars)`;
  }
  return value;
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });

  // Nilai efektif + sumbernya untuk semua kunci yang diatur dashboard.
  const numbers: Array<[string, { value: number; source: string }]> = [
    ["payment_ttl_seconds", effectivePaymentTtlSeconds()],
    ["callback_timeout_ms", effectiveCallbackTimeoutMs()],
    ["monitor_poll_interval_ms", effectiveMonitorPollIntervalMs()],
    ["monitor_viewer_lease_ms", effectiveMonitorViewerLeaseMs()],
    ["monitor_tick_ms", effectiveMonitorTickMs()],
  ];

  const overrides = new Map(listSettings().map((r) => [r.key, r.updated_at]));

  return NextResponse.json({
    success: true,
    data: {
      effective: [
        { key: "app_url", ...effectiveAppUrl() },
        ...numbers.map(([key, v]) => ({ key, ...v })),
        { key: "integration_secret_set", value: hasExplicitIntegrationSecret(), source: "info" },
      ],
      overrides: [...overrides.entries()].map(([key, updated_at]) => ({ key, updated_at })),
    },
  });
}

export async function PUT(req: Request) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }

  for (const [key, raw] of Object.entries((body ?? {}) as Record<string, unknown>)) {
    if (!(EDITABLE_KEYS as readonly string[]).includes(key)) {
      return NextResponse.json({ success: false, error: `kunci tidak diizinkan: ${key}` }, { status: 400 });
    }
    if (typeof raw !== "string") {
      return NextResponse.json({ success: false, error: `${key} harus string` }, { status: 400 });
    }
    const value = raw.trim();

    // Nilai kosong = hapus override -> kembali ke fallback env/default.
    if (!value) {
      deleteSetting(key);
      logAudit({
        actor: session.username,
        action: "admin.settings.clear",
        entityType: "setting",
        entityId: key,
        ip: clientIp(req.headers),
      });
      continue;
    }

    // --- Validasi per tipe ---
    const bounds = NUMBER_BOUNDS[key as EditableKey];
    if (bounds) {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < bounds.min || n > bounds.max) {
        return NextResponse.json(
          { success: false, error: `${key} harus bilangan bulat ${bounds.min}..${bounds.max}` },
          { status: 422 }
        );
      }
      setSetting(key, Math.trunc(n));
    } else if (key === "qris_static") {
      if (!validateQrisChecksum(value)) {
        return NextResponse.json(
          { success: false, error: "Checksum CRC16 QRIS tidak valid — pastikan payload lengkap sampai tag 6304." },
          { status: 422 }
        );
      }
      setSetting(key, value);
    } else if (key === "gopay_merchant_id") {
      // Terima "566035778" maupun "G566035778" - simpan SELALU kanonik berprefix G.
      if (!/^[gG]?[0-9]{4,19}$/.test(value)) {
        return NextResponse.json({ success: false, error: "merchant_id tidak valid (contoh: G566035778)" }, { status: 422 });
      }
      setSetting(key, normalizeGoPayMerchantId(value));
    } else if (key === "integration_secret" || key === "session_secret") {
      if (value.length < 32) {
        return NextResponse.json(
          { success: false, error: `${key} minimal 32 karakter` },
          { status: 422 }
        );
      }
      setSetting(key, value);
    } else if (key === "app_url") {
      if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value)) {
        return NextResponse.json(
          { success: false, error: "app_url harus URL http(s) lengkap, mis. https://pay.domain.com" },
          { status: 422 }
        );
      }
      setSetting(key, value.replace(/\/+$/, ""));
    } else {
      return NextResponse.json({ success: false, error: `kunci tidak dikenal: ${key}` }, { status: 400 });
    }

    logAudit({
      actor: session.username,
      action: "admin.settings.update",
      entityType: "setting",
      entityId: key,
      details: redactValue(key, value),
      ip: clientIp(req.headers),
    });
  }
  return NextResponse.json({ success: true });
}
