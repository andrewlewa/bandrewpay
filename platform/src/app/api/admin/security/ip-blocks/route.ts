import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import { listBlocks, unblockIp, upsertBlock, isValidIp } from "@/lib/auth/ip-guard";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — daftar semua blokir IP (termasuk yang kedaluwarsa, untuk audit). */
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });
  return NextResponse.json({ success: true, data: { blocks: listBlocks() } });
}

/** POST — blokir IP manual. body: {ip, minutes?: number|null (null=permanen), reason?} */
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  if (!isValidIp(ip)) return NextResponse.json({ success: false, error: "IP tidak valid" }, { status: 422 });

  const now = Date.now();
  const minutes =
    body.minutes === null || body.minutes === undefined
      ? null
      : Math.max(1, Math.trunc(Number(body.minutes) || 0)) || null;
  const block = {
    ip,
    reason: typeof body.reason === "string" && body.reason.trim() ? `manual oleh ${session.username}: ${body.reason.trim()}` : `manual oleh ${session.username}`,
    blocked_at: now,
    expires_at: minutes === null ? null : now + minutes * 60_000,
  };
  upsertBlock(block);
  logAudit({ actor: session.username, action: "security.ip.block", entityType: "ip_block", entityId: ip, ip: clientIp(req.headers) });
  return NextResponse.json({ success: true, data: block });
}

/** DELETE?ip=x — buka blokir. */
export async function DELETE(req: Request) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }
  const ip = new URL(req.url).searchParams.get("ip")?.trim() ?? "";
  if (!ip) return NextResponse.json({ success: false, error: "ip wajib" }, { status: 422 });

  const removed = unblockIp(ip);
  logAudit({ actor: session.username, action: "security.ip.unblock", entityType: "ip_block", entityId: ip, ip: clientIp(req.headers) });
  return NextResponse.json({ success: true, data: { removed } });
}
