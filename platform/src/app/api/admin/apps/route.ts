import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import {
  listIntegrationApps,
  newIntegrationApp,
  isAcceptableHttpUrl,
  maskSecret,
} from "@/lib/integrations";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — daftar aplikasi (secret dimask; tidak pernah utuh). */
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });
  return NextResponse.json({
    success: true,
    data: {
      apps: listIntegrationApps().map((a) => ({
        id: a.id,
        label: a.label,
        secret_masked: maskSecret(a.secret),
        has_secret: !!a.secret,
        callback_url: a.callback_url,
        redirect_url: a.redirect_url,
        active: a.active,
        created_at: a.created_at,
        last_used_at: a.last_used_at,
      })),
    },
  });
}

/** POST — daftarkan aplikasi baru. Secret utuh dikembalikan SEKALI di sini. */
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

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 100) {
    return NextResponse.json({ success: false, error: "label wajib (maks 100 karakter)" }, { status: 422 });
  }
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (secret && secret.length < 32) {
    return NextResponse.json({ success: false, error: "secret manual minimal 32 karakter (atau kosongkan untuk auto-generate)" }, { status: 422 });
  }
  for (const field of ["callback_url", "redirect_url"] as const) {
    const v = body[field];
    if (v !== undefined && v !== null && v !== "" && !isAcceptableHttpUrl(v)) {
      return NextResponse.json({ success: false, error: `${field} harus URL http(s) valid atau kosong` }, { status: 422 });
    }
  }

  const { app, generatedSecret } = newIntegrationApp({
    label,
    secret: secret || undefined,
    callback_url: (body.callback_url as string) || null,
    redirect_url: (body.redirect_url as string) || null,
  });
  logAudit({
    actor: session.username,
    action: "admin.apps.create",
    entityType: "api_credential",
    entityId: app.id,
    details: label,
    ip: clientIp(req.headers),
  });

  return NextResponse.json({
    success: true,
    data: {
      id: app.id,
      label: app.label,
      // Satu-satunya momen secret utuh dikirim ke klien.
      secret: app.secret,
      secret_generated: generatedSecret !== null,
      callback_url: app.callback_url,
      redirect_url: app.redirect_url,
    },
  });
}
