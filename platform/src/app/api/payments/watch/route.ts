import { NextResponse } from "next/server";
import { z } from "zod";
import { heartbeatViewer } from "@/lib/monitor/coordinator";
import { clientIp, checkRate } from "@/lib/rate-limit";
import { effectiveMonitorViewerLeaseMs } from "@/lib/config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  transaction_id: z.string().regex(/^TRX-[0-9a-fA-F]{16}$/),
  viewer_id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
});

/** POST /api/payments/watch — heartbeat lease viewer (dipanggil halaman bayar). */
export async function POST(req: Request) {
  const ip = clientIp(req.headers) ?? "unknown";
  if (!checkRate(`watch:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ success: false, error: "rate limit" }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "payload tidak valid" }, { status: 422 });
  }

  const accepted = heartbeatViewer(parsed.data.viewer_id, parsed.data.transaction_id);
  if (!accepted) {
    return NextResponse.json({ success: false, error: "transaksi tidak dapat dipantau" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: { lease_ms: effectiveMonitorViewerLeaseMs().value },
  });
}
