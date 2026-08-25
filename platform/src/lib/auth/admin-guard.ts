import { getAdminSession, type AdminSession } from "@/lib/auth/session";

export const SESSION_COOKIE = "bp_admin_session";
export const CSRF_COOKIE = "bp_csrf";

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

/**
 * Flag `secure` ADAPTIF terhadap protokol aktual request — bukan NODE_ENV.
 * Di produksi atas HTTP langsung (LAN/VPS tanpa TLS), browser modern MENOLAK
 * cookie Secure sehingga login tampak gagal padahal valid di server.
 */
export function sessionCookieOptions(maxAgeSeconds: number, isHttps = false) {
  return { ...COOKIE_BASE, maxAge: maxAgeSeconds, secure: isHttps };
}

/** Deteksi HTTPS dari headers/URL request (konsisten dengan middleware CSP). */
export function requestIsHttps(req: Request): boolean {
  const fwd = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (fwd) return fwd === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Ambil sesi admin valid dari cookie request (untuk RSC & route handlers). */
export async function requireAdminSession(): Promise<AdminSession | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return getAdminSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * Verifikasi CSRF untuk mutasi admin: token di header harus sama dengan
 * yang tersimpan pada baris sesi di DB DAN cookie double-submit.
 */
export function verifyCsrf(session: AdminSession, headerToken: string | null, cookieToken?: string): boolean {
  if (!headerToken || !cookieToken) return false;
  return headerToken === session.csrf_token && headerToken === cookieToken;
}
