import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "bp_admin_session";

/**
 * Middleware global:
 * 1. CSP ketat dengan nonce (pola resmi Next.js).
 * 2. Gate kasar /admin/*: tanpa cookie sesi -> redirect ke login.
 *    Validasi sesi yang sebenarnya tetap dilakukan di admin layout & API.
 */
export function middleware(request: NextRequest) {
  // --- Gate admin ---
  const { pathname } = request.nextUrl;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApi = pathname.startsWith("/api/admin");
  if ((isAdminPage || isAdminApi) && pathname !== "/admin/login" && pathname !== "/api/admin/login") {
    const hasCookie = !!request.cookies.get(SESSION_COOKIE)?.value;
    if (!hasCookie) {
      if (isAdminApi) {
        return NextResponse.json(
          { success: false, error: "Tidak terautentikasi" },
          { status: 401 }
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  // --- CSP nonce ---
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  // `upgrade-insecure-requests` HANYA saat request memang lewat HTTPS (produksi
  // di balik proxy TLS). Bila aktif di akses HTTP langsung (LAN/VPS tanpa TLS),
  // direktif ini memaksa browser meng-upgrade ke https sehingga aplikasi
  // tidak bisa dibuka dari HP di jaringan lokal.
  const fwdProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isHttps = fwdProto === "https" || request.nextUrl.protocol === "https:";
  const csp = [
    `default-src 'self'`,
    // strict-dynamic + nonce: skrip Next.js sah saja yang bisa jalan.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ""}`.trim(),
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Halaman bayar sengaja embeddable oleh integrator; admin diblokir via X-Frame-Options DENY.
    `frame-ancestors *`,
    ...(isDev || !isHttps ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  // PENTING: nama header ini TIDAK BOLEH bertabrakan dengan header API
  // (X-BP-Timestamp/X-BP-Nonce/X-BP-Signature dipakai verifikasi HMAC integrasi).
  requestHeaders.set("x-csp-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Jalankan di semua path kecuali aset statis internal.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)",
  ],
};
