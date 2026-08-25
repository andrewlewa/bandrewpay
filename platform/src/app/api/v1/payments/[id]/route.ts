import { NextResponse } from "next/server";
import { verifyIntegrationRequest } from "@/lib/integration-auth";
import { getTransaction } from "@/lib/payments/transactions-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/payments/{id} — status S2S untuk integrator (HMAC-signed). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await verifyIntegrationRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await ctx.params;
  const tx = getTransaction(id);
  if (!tx) {
    return NextResponse.json({ success: false, error: "transaksi tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    data: {
      transaction_id: tx.id,
      order_id: tx.order_id,
      amount: tx.amount,
      status: tx.status.toLowerCase(),
      paid_amount: tx.paid_amount,
      created_at: new Date(tx.created_at).toISOString(),
      expires_at: new Date(tx.expires_at).toISOString(),
      paid_at: tx.paid_at ? new Date(tx.paid_at).toISOString() : null,
    },
  });
}
