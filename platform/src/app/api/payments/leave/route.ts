import { NextResponse } from "next/server";
import { releaseViewer } from "@/lib/monitor/coordinator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/leave — dilepas via navigator.sendBeacon saat tab ditutup
 * (body text/plain dari sendBeacon diparse longgar).
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const json: unknown = JSON.parse(raw);
    const viewerId =
      typeof json === "object" && json !== null && "viewer_id" in json
        ? String((json as { viewer_id: unknown }).viewer_id)
        : "";
    if (/^[A-Za-z0-9_-]{16,64}$/.test(viewerId)) {
      releaseViewer(viewerId);
    }
  } catch {
    // sendBeacon saat unload — abaikan body rusak.
  }
  return new Response(null, { status: 204 });
}
