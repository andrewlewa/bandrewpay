import { NextResponse } from "next/server";
import { getDb } from "@/db/index";
import { loadSession, isExpired } from "@/lib/payments/gojek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    getDb().prepare("SELECT 1").get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const session = loadSession();
  return NextResponse.json({
    success: true,
    status: dbOk ? "ok" : "degraded",
    service: "bandrewpay",
    time: new Date().toISOString(),
    database: { ok: dbOk },
    provider: {
      sessionLoaded: !!session?.access_token,
      sessionExpired: session ? isExpired(session) : true,
      // Tidak pernah expose token/isi sesi.
    },
  });
}
