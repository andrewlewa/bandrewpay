import { NextResponse } from "next/server";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { createPaymentSchema, createPayment, buildPaymentUrl } from "@/lib/payments/service";
import { logAudit } from "@/lib/audit";
import { clientIp, checkRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payments — buat transaksi QRIS (HMAC-signed).
 * Respons selalu envelope {success: boolean, ...} agar kompatibel
 * dengan kontrak integrator legacy.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!checkRate(`create:${ip ?? "unknown"}`, 30, 60_000).allowed) {
    return NextResponse.json({ success: false, error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const auth = await verifyIntegrationRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(auth.rawBody ?? "");
  } catch {
    return NextResponse.json({ success: false, error: "body bukan JSON valid" }, { status: 400 });
  }

  const parsed = createPaymentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "payload tidak valid", details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 422 }
    );
  }

  const result = await createPayment(parsed.data, auth.credential?.id ?? null);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 503 });
  }

  const { transaction, reused } = result;
  logAudit({
    actor: "integration",
    action: reused ? "payment.create.reused" : "payment.create",
    entityType: "transaction",
    entityId: transaction.id,
    details: { order_id: transaction.order_id, amount: transaction.amount },
    ip,
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        amount: transaction.amount,
        payable_amount: transaction.payable_amount || transaction.amount,
        status: transaction.status,
        payment_url: buildPaymentUrl(transaction.id),
        expires_at: new Date(transaction.expires_at).toISOString(),
      },
    },
    { status: reused ? 200 : 201 }
  );
}
