import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import { loadSession, refreshSession } from "@/lib/payments/gojek";
import { recordRefreshStatus } from "@/lib/payments/provider-refresh";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/provider/refresh — refresh token manual via tombol dashboard
 * (grant_type=refresh_token ke GoBiz; BUKAN login OTP ulang).
 */
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }

  if (!loadSession()?.refresh_token) {
    return NextResponse.json(
      { success: false, error: "Belum ada sesi provider untuk di-refresh. Login via OTP dulu." },
      { status: 422 }
    );
  }

  let refreshed = false;
  try {
    refreshed = !!(await refreshSession());
  } catch {
    refreshed = false;
  }
  recordRefreshStatus(refreshed, refreshed ? undefined : "manual_refresh_failed");
  logAudit({
    actor: session.username,
    action: refreshed ? "provider.refresh.manual" : "provider.refresh.manual_failed",
    entityType: "provider_session",
    entityId: "gopay",
    ip: clientIp(req.headers),
  });

  if (!refreshed) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Refresh gagal — sesi upstream mungkin sudah dicabut. Coba lagi; bila terus gagal, lakukan login OTP di bawah.",
      },
      { status: 422 }
    );
  }
  return NextResponse.json({ success: true, data: { ok: true } });
}
