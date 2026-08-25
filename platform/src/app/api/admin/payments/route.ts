import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import { createPayment, createPaymentSchema } from "@/lib/payments/service";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buat pembayaran manual dari dashboard admin (tanpa HMAC integrasi).
 * order_id boleh kosong -> digenerate otomatis dengan awalan MAN-.
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }

  // Trim + order_id kosong -> generate otomatis.
  for (const key of ["order_id", "customer_name", "customer_email", "callback_url", "redirect_url"]) {
    if (typeof body[key] === "string") {
      if ((body[key] as string).trim() === "") delete body[key];
      else body[key] = (body[key] as string).trim();
    }
  }
  if (!body.order_id) {
    body.order_id = `MAN-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  }

  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { success: false, error: `${first.path.join(".") || "input"}: ${first.message}` },
      { status: 422 }
    );
  }

  const result = await createPayment(parsed.data, null);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 422 });
  }

  logAudit({
    actor: session.username,
    action: "admin.payment.create_manual",
    entityType: "transaction",
    entityId: result.transaction.id,
    details: { order_id: result.transaction.order_id, amount: result.transaction.amount, reused: result.reused },
  });

  return NextResponse.json({
    success: true,
    data: {
      transaction_id: result.transaction.id,
      order_id: result.transaction.order_id,
      amount: result.transaction.amount,
      payable_amount: result.transaction.payable_amount || result.transaction.amount,
      payment_url: `/pay/${result.transaction.id}`,
      qr_url: `/api/pay/${result.transaction.id}/qr.png`,
      expires_at: result.transaction.expires_at,
      reused: result.reused,
      detail_url: `/admin/transactions/${result.transaction.id}`,
    },
  });
}
