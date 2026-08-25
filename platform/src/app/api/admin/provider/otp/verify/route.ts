import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import { verifyOtp } from "@/lib/payments/provider-login";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — verifikasi OTP; sukses = sesi provider baru tersimpan di SQLite. */
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }

  let body: { otp?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }
  if (typeof body.otp !== "string") {
    return NextResponse.json({ success: false, error: "otp wajib string" }, { status: 422 });
  }

  const result = await verifyOtp(body.otp);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }
  logAudit({
    actor: session.username,
    action: "admin.provider.otp.verify",
    entityType: "provider_session",
    entityId: "gopay",
    ip: clientIp(req.headers),
  });
  return NextResponse.json({ success: true, data: result.session });
}
