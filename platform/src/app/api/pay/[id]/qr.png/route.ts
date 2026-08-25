import { getTransaction } from "@/lib/payments/transactions-repo";
import { clientIp, checkRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pay/{id}/qr.png — render QRIS dari payload di DB.
 * Tidak ada file artifact: path tidak dapat ditebak, tidak ada cache publik,
 * dan QR expired otomatis "hilang" (410).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req.headers) ?? "unknown";
  if (!checkRate(`qr:${ip}`, 60, 60_000).allowed) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const { id } = await ctx.params;
  if (!/^TRX-[0-9a-fA-F]{16}$/.test(id)) {
    return new Response("Invalid id", { status: 400 });
  }

  const tx = getTransaction(id);
  if (!tx || !tx.qris_payload) {
    return new Response("Not found", { status: 404 });
  }
  if (tx.status !== "PENDING" && tx.status !== "PAID") {
    return new Response("Gone", { status: 410 });
  }

  const QRCode = await import("qrcode");
  try {
    const buffer = await QRCode.toBuffer(tx.qris_payload, {
      type: "png",
      width: 640,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=30",
        "Content-Disposition": `inline; filename="${id}.png"`,
      },
    });
  } catch {
    return new Response("QR render gagal", { status: 500 });
  }
}
