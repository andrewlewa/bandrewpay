import { NextResponse } from "next/server";
import { requireAdminSession, SESSION_COOKIE } from "@/lib/auth/admin-guard";
import { destroyAdminSession } from "@/lib/auth/session";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await requireAdminSession();
  if (token) destroyAdminSession(token);

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set("bp_csrf", "", { path: "/", maxAge: 0 });
  void session;
  return response;
}
