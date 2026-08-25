/*
 * RouteTransition — memutar animasi masuk halaman setiap kali rute admin
 * berpindah (key = pathname me-remount subtree, sehingga .bp-page-enter
 * serta .bp-stagger di dalamnya ikut diputar ulang).
 */
"use client";

import { usePathname } from "next/navigation";

export default function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="bp-page-enter">
      {children}
    </div>
  );
}
