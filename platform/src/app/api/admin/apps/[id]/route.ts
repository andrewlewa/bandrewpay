import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import {
  getIntegrationApp,
  updateIntegrationApp,
  rotateIntegrationAppSecret,
  deleteIntegrationApp,
  isAcceptableHttpUrl,
} from "@/lib/integrations";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT — update label/callback/redirect/active; `rotate_secret: true` -> secret baru (dikembalikan sekali). */
export async function PUT(req: Request, ctx: Ctx) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }

  for (const field of ["callback_url", "redirect_url"] as const) {
    if (field in body) {
      const v = body[field];
      if (v !== null && v !== "" && !isAcceptableHttpUrl(v)) {
        return NextResponse.json({ success: false, error: `${field} harus URL http(s) valid atau null` }, { status: 422 });
      }
    }
  }

  let rotatedSecret: string | null = null;
  if (body.rotate_secret === true) {
    const manual = typeof body.secret === "string" && body.secret.trim() ? body.secret.trim() : undefined;
    if (manual && manual.length < 32) {
      return NextResponse.json({ success: false, error: "secret manual minimal 32 karakter" }, { status: 422 });
    }
    const rotated = rotateIntegrationAppSecret(id, manual);
    if (!rotated) return notFound();
    rotatedSecret = rotated.secret;
  } else {
    const patch: Parameters<typeof updateIntegrationApp>[1] = {};
    if (typeof body.label === "string") patch.label = body.label;
    if ("callback_url" in body) patch.callback_url = (body.callback_url as string) || null;
    if ("redirect_url" in body) patch.redirect_url = (body.redirect_url as string) || null;
    if (typeof body.active === "boolean") patch.active = body.active;
    const updated = updateIntegrationApp(id, patch);
    if (!updated) return notFound();
  }

  logAudit({
    actor: session.username,
    action: body.rotate_secret === true ? "admin.apps.rotate_secret" : "admin.apps.update",
    entityType: "api_credential",
    entityId: id,
    ip: clientIp(req.headers),
  });

  return NextResponse.json({
    success: true,
    data: {
      id,
      ...(rotatedSecret ? { secret: rotatedSecret } : {}),
    },
  });
}

/** DELETE — hapus aplikasi. Transaksi lama tetap ada (integration_id jadi NULL). */
export async function DELETE(req: Request, ctx: Ctx) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!getIntegrationApp(id)) return notFound();

  // FK transactions.integration_id ON DELETE SET NULL — callback lama pakai secret global.
  deleteIntegrationApp(id);
  logAudit({
    actor: session.username,
    action: "admin.apps.delete",
    entityType: "api_credential",
    entityId: id,
    ip: clientIp(req.headers),
  });
  return NextResponse.json({ success: true });
}

function notFound() {
  return NextResponse.json({ success: false, error: "aplikasi tidak ditemukan" }, { status: 404 });
}
