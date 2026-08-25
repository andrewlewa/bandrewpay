import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP di-set dinamis dengan nonce oleh src/middleware.ts (pola resmi Next.js).
// Header statis lain didefinisikan di sini.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Halaman bayar sengaja bisa di-frame oleh Paymenter (iframe invoice),
  // jadi frame-ancestors dikontrol per-route lewat middleware, bukan DENY global.
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "*": ["./data/**"],
  },
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Admin tidak boleh di-frame siapapun
        source: "/admin/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
