import { NextResponse } from "next/server";
import { getTransaction, acquireCheckSlot } from "@/lib/payments/transactions-repo";
import { verifyAndNotify } from "@/lib/payments/service";
import { clientIp, checkRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/{id}/check — tombol "Cek Status" manual buyer.
 * Melewati single-flight + slot throttle yang sama dengan coordinator,
 * jadi spam klik TIDAK menggandakan panggilan upstream.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req.headers) ?? "unknown";
  if (!checkRate(`check:${ip}`, 6, 60_000).allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pengecekan. Coba lagi sebentar." },
      { status: 429 }
    );
  }

  const { id } = await ctx.params;
  if (!/^TRX-[0-9a-fA-F]{16}$/.test(id)) {
    return NextResponse.json({ success: false, error: "id tidak valid" }, { status: 400 });
  }

  const tx = getTransaction(id);
  if (!tx) {
    return NextResponse.json({ success: false, error: "transaksi tidak ditemukan" }, { status: 404 });
  }

  let outcome = "ALREADY_RESOLVED";
  if (tx.status === "PENDING") {
    // Slot throttle lebih longgar dari coordinator (3s) supaya tombol terasa responsif.
    if (acquireCheckSlot(id, 3_000)) {
      const result = await verifyAndNotify(id);
      outcome = result.outcome;
    } else {
      outcome = "THROTTLED";
    }
  }

  const current = getTransaction(id)!;
  return NextResponse.json(
    {
      success: true,
      data: {
        transaction_id: current.id,
        status: current.status.toLowerCase(),
        amount: current.amount,
        expires_at: current.expires_at,
        paid_at: current.paid_at,
        redirect_url: current.status === "PAID" ? current.redirect_url : null,
        check_outcome: outcome.toLowerCase(),
        server_now_ms: Date.now(),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
