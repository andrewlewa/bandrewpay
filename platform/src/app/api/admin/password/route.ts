import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE, SESSION_COOKIE } from "@/lib/auth/admin-guard";
import { getDb } from "@/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/password — ganti password akun yang sedang login.
 * Wajib: password saat ini + CSRF. Setelah sukses, semua sesi LAIN
 * milik user ini dicabut (sesi sekarang dipertahankan).
 */
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }

  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "body tidak valid" }, { status: 400 });
  }
  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";

  if (!current || !next) {
    return NextResponse.json({ success: false, error: "password lama & baru wajib diisi" }, { status: 422 });
  }
  if (next.length < 8 || next.length > 1024) {
    return NextResponse.json({ success: false, error: "password baru minimal 8 karakter" }, { status: 422 });
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id, username, password_hash FROM users WHERE id = ?")
    .get(session.user_id) as { id: string; username: string; password_hash: string } | undefined;
  if (!user || !verifyPassword(current, user.password_hash)) {
    return NextResponse.json({ success: false, error: "password saat ini salah" }, { status: 401 });
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    hashPassword(next),
    Date.now(),
    user.id
  );

  // Cabut sesi lain; sesi sekarang tetap aktif.
  const currentToken = store.get(SESSION_COOKIE)?.value ?? "";
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(user.id, currentToken);

  logAudit({
    actor: session.username,
    action: "admin.password.change",
    entityType: "user",
    entityId: user.id,
    ip: clientIp(req.headers),
  });

  return NextResponse.json({ success: true });
}
