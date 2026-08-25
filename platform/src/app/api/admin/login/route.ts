import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { attemptLogin } from "@/lib/auth/login";
import { SESSION_IDLE_MS } from "@/lib/auth/session";
import { SESSION_COOKIE, sessionCookieOptions, requestIsHttps } from "@/lib/auth/admin-guard";
import { clientIp, checkRate } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { isIpBlocked, autoBlockIfAbusive } from "@/lib/auth/ip-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/login — dua mode:
 *  - JSON (fetch dari LoginForm saat JS aktif) -> respons JSON.
 *  - x-www-form-urlencoded (submit native <form method="post"> bila JS gagal
 *    hydrate) -> 303 redirect, TIDAK PERNAH kembali ke GET dengan password di URL.
 *
 * Pemberlakuan keamanan: IP diblokir (otomatis/manual) -> 403 sebelum apa pun;
 * rate limit per-IP tetap berlaku; gagal >=10x/15 menit per IP -> blokir 30 menit.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const contentType = req.headers.get("content-type") ?? "";
  const nativeForm = contentType.includes("application/x-www-form-urlencoded");

  // --- Blokir IP (manual/otomatis) ---
  const blocked = isIpBlocked(ip);
  if (blocked) {
    logAudit({ actor: "?", action: "admin.login.blocked_ip", ip });
    return reject(nativeForm, req, `Akses ditolak: IP Anda diblokir (${blocked.reason}).`, {
      blockExpiresAt: blocked.expires_at,
    });
  }

  if (!checkRate(`login:${ip ?? "unknown"}`, 10, 5 * 60_000).allowed) {
    return reject(nativeForm, req, "Terlalu banyak percobaan. Coba lagi nanti.", { status: 429 });
  }

  let username = "";
  let password = "";
  try {
    if (nativeForm) {
      const form = await req.formData();
      username = String(form.get("username") ?? "");
      password = String(form.get("password") ?? "");
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      username = typeof body.username === "string" ? body.username : "";
      password = typeof body.password === "string" ? body.password : "";
    }
  } catch {
    return reject(nativeForm, req, "Body tidak valid.", { status: 400 });
  }

  const result = attemptLogin({ username, password, ip, userAgent: req.headers.get("user-agent") });

  if (!result.ok) {
    logAudit({
      actor: username || "?",
      action: result.error === "LOCKED" ? "admin.login.locked" : "admin.login.failed",
      ip,
    });
    // Evaluasi blokir otomatis per-IP setelah kegagalan.
    const newBlock = autoBlockIfAbusive(ip);
    if (newBlock) {
      return reject(nativeForm, req, "Terlalu banyak kegagalan — IP Anda diblokir sementara.", {
        blockExpiresAt: newBlock.expires_at,
      });
    }
    return reject(
      nativeForm,
      req,
      result.error === "LOCKED"
        ? `Akun terkunci. Coba lagi dalam ${Math.ceil((result.retryAfterSeconds ?? 0) / 60)} menit.`
        : "Username atau password salah.",
      { status: result.error === "LOCKED" ? 423 : 401 }
    );
  }

  logAudit({ actor: "session", action: "admin.login.success", ip });

  // Cookie CSRF dapat dibaca JS client (double-submit), sesi tetap HttpOnly.
  const store = await cookies();
  const httpsCookies = requestIsHttps(req);
  store.set(SESSION_COOKIE, result.token, sessionCookieOptions(Math.floor(SESSION_IDLE_MS / 1000), httpsCookies));
  store.set("bp_csrf", result.csrfToken, {
    ...sessionCookieOptions(Math.floor(SESSION_IDLE_MS / 1000), httpsCookies),
    httpOnly: false,
  });

  if (nativeForm) {
    return NextResponse.redirect(new URL("/admin", req.url), 303);
  }
  return NextResponse.json({ success: true });
}

/** GET — probe sesi untuk klien admin. */
export async function GET() {
  const { requireAdminSession } = await import("@/lib/auth/admin-guard");
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });
  return NextResponse.json({ success: true, data: { username: session.username, role: session.role } });
}

function reject(
  nativeForm: boolean,
  req: Request,
  message: string,
  opts?: { status?: number; blockExpiresAt?: number | null }
): NextResponse {
  if (!nativeForm) {
    const status = opts?.blockExpiresAt !== undefined ? 403 : (opts?.status ?? 401);
    return NextResponse.json(
      { success: false, error: message, ...(opts?.blockExpiresAt !== undefined ? { blocked_until: opts.blockExpiresAt } : {}) },
      { status }
    );
  }
  // Native form: pesan error lewat query param halaman login (tanpa refleksikan input).
  const url = new URL("/admin/login", req.url);
  url.searchParams.set("err", "1");
  return NextResponse.redirect(url, 303);
}
