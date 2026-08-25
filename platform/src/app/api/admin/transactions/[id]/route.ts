import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import {
  getTransaction,
  transitionTransaction,
  listEvents,
} from "@/lib/payments/transactions-repo";
import { verifyAndNotify } from "@/lib/payments/service";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";
import type { TransactionStatus } from "@/lib/payments/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION_TARGET: Partial<Record<string, TransactionStatus>> = {
  cancel: "CANCELLED",
  mark_failed: "FAILED",
};

/** GET — detail + riwayat event satu transaksi. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });

  const { id } = await ctx.params;
  const tx = getTransaction(id);
  if (!tx) return NextResponse.json({ success: false, error: "tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ success: true, data: { transaction: tx, events: listEvents(id) } });
}

/** POST — aksi admin pada transaksi (CSRF-protected). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }
  const action = (body as { action?: string }).action;
  const ip = clientIp(req.headers);

  const tx = getTransaction(id);
  if (!tx) return NextResponse.json({ success: false, error: "tidak ditemukan" }, { status: 404 });

  if (action === "recheck") {
    const result = await verifyAndNotify(id);
    logAudit({ actor: session.username, action: "admin.transaction.recheck", entityType: "transaction", entityId: id, details: result, ip });
    return NextResponse.json({
      success: true,
      data: { outcome: result.outcome.toLowerCase(), transaction: getTransaction(id) },
    });
  }

  const target = action ? ACTION_TARGET[action] : undefined;
  if (target && tx.status === "PENDING") {
    const won = transitionTransaction(id, "PENDING", target);
    logAudit({
      actor: session.username,
      action: `admin.transaction.${action}`,
      entityType: "transaction",
      entityId: id,
      details: { applied: won },
      ip,
    });
    if (!won) {
      return NextResponse.json({ success: false, error: "status sudah berubah" }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: { transaction: getTransaction(id) } });
  }

  return NextResponse.json(
    { success: false, error: "aksi tidak didukung atau transaksi tidak lagi PENDING" },
    { status: 400 }
  );
}
