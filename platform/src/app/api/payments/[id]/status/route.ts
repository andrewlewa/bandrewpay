import { NextResponse } from "next/server";
import { getTransaction } from "@/lib/payments/transactions-repo";
import { clientIp, checkRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/{id}/status — endpoint polling buyer.
 * HANYA membaca DB (murah, tanpa panggilan upstream). Countdown
 * bersifat server-authoritative: client menghitung offset dari server_now_ms.
 * Field yang bocor sengaja dibatasi (tanpa email/customer).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req.headers) ?? "unknown";
  if (!checkRate(`status:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ success: false, error: "rate limit" }, { status: 429 });
  }

  const { id } = await ctx.params;
  if (!/^TRX-[0-9a-fA-F]{16}$/.test(id)) {
    return NextResponse.json({ success: false, error: "id tidak valid" }, { status: 400 });
  }

  const tx = getTransaction(id);
  if (!tx) {
    return NextResponse.json({ success: false, error: "transaksi tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        transaction_id: tx.id,
        status: tx.status.toLowerCase(),
        amount: tx.amount,
        payable_amount: tx.payable_amount || tx.amount,
        expires_at: tx.expires_at,
        paid_at: tx.paid_at,
        redirect_url: tx.status === "PAID" ? tx.redirect_url : null,
        server_now_ms: Date.now(),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
