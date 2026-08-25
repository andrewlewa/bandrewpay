import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import { getDb } from "@/db";
import { loadSession, isExpired } from "@/lib/payments/gojek";
import { getPendingMeta } from "@/lib/payments/provider-login";
import { getRefreshStatus, nextRefreshAtMs, PROVIDER_REFRESH_INTERVAL_MS } from "@/lib/payments/provider-refresh";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — status sesi provider (metadata saja; token tidak pernah dikirim). */
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });
  const s = loadSession();
  return NextResponse.json({
    success: true,
    data: {
      has_session: !!s?.access_token || !!s?.refresh_token,
      expired: s ? isExpired(s) : true,
      phone_number_masked: s ? mask(s.phone_number) : null,
      outlet_name: s?.outlet_name ?? null,
      merchant_id: s?.merchant_id ?? null,
      updated_at: s?.updated_at ?? null,
      expires_at: s?.expires_at ?? null,
      storage: "database (provider_session)",
      pending_otp: getPendingMeta(),
      auto_refresh: {
        interval_ms: PROVIDER_REFRESH_INTERVAL_MS,
        next_refresh_at: nextRefreshAtMs(),
        last_status: getRefreshStatus(),
      },
    },
  });
}

/** DELETE — hapus sesi provider dari DB (logout GoPay Merchant). */
export async function DELETE(req: Request) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }
  const had = !!loadSession();
  getDb().prepare("DELETE FROM provider_session WHERE id = 1").run();
  if (had) {
    logAudit({
      actor: session.username,
      action: "admin.provider.session.delete",
      entityType: "provider_session",
      entityId: "gopay",
      ip: clientIp(req.headers),
    });
  }
  return NextResponse.json({ success: true });
}

function mask(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;
  return `+62${"*".repeat(Math.max(digits.length - 6, 3))}${digits.slice(-4)}`;
}
