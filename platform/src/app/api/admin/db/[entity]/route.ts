import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdminSession, verifyCsrf, CSRF_COOKIE } from "@/lib/auth/admin-guard";
import { getDb } from "@/db/index";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Database browser aman: hanya entitas allowlist, hanya kolom yang dipilih,
 * tanpa SQL mentah dari input user. Delete dibatasi entitas non-keuangan.
 */

type EntityDef = {
  table: string;
  orderBy: string;
  columns: string[];
  searchable?: string[];
  deletable?: boolean;
};

const ENTITIES: Record<string, EntityDef> = {
  transactions: {
    table: "transactions",
    orderBy: "created_at DESC",
    columns: [
      "id", "order_id", "integration_id", "amount", "status", "customer_name", "customer_email",
      "callback_url", "redirect_url", "expires_at", "created_at", "paid_at", "paid_amount", "matched_provider_tx",
    ],
    searchable: ["id", "order_id"],
  },
  payment_events: {
    table: "payment_events",
    orderBy: "id DESC",
    columns: ["id", "transaction_id", "event_type", "payload_json", "created_at"],
    searchable: ["transaction_id", "event_type"],
  },
  claims: {
    table: "claims",
    orderBy: "claimed_at DESC",
    columns: ["provider_tx_id", "transaction_id", "claimed_at"],
    searchable: ["provider_tx_id", "transaction_id"],
  },
  callback_deliveries: {
    table: "callback_deliveries",
    orderBy: "created_at DESC",
    columns: [
      "id", "transaction_id", "url", "event_type", "status", "attempts",
      "max_attempts", "next_retry_at", "last_response_code", "last_error", "delivered_at", "created_at",
    ],
    searchable: ["id", "transaction_id", "url"],
  },
  webhook_events: {
    table: "webhook_events",
    orderBy: "received_at DESC",
    columns: ["id", "source", "event_type", "payload_json", "processed", "received_at"],
    searchable: ["id", "source"],
  },
  users: {
    table: "users",
    orderBy: "username ASC",
    // password_hash sengaja TIDAK diekspos.
    columns: ["id", "username", "role", "failed_attempts", "locked_until", "created_at", "updated_at", "last_login_at"],
    searchable: ["username"],
  },
  sessions: {
    table: "sessions",
    orderBy: "last_seen_at DESC",
    columns: ["id", "user_id", "created_at", "idle_expires_at", "absolute_expires_at", "last_seen_at", "ip"],
    searchable: ["user_id"],
    deletable: true,
  },
  login_attempts: {
    table: "login_attempts",
    orderBy: "attempted_at DESC",
    columns: ["id", "username", "ip", "successful", "attempted_at"],
    searchable: ["username", "ip"],
  },
  audit_logs: {
    table: "audit_logs",
    orderBy: "id DESC",
    columns: ["id", "actor", "action", "entity_type", "entity_id", "details_json", "ip", "created_at"],
    searchable: ["actor", "action", "entity_id"],
  },
  monitor_viewers: {
    table: "monitor_viewers",
    orderBy: "started_at DESC",
    columns: ["viewer_id", "transaction_id", "expires_at", "started_at"],
    searchable: ["viewer_id", "transaction_id"],
  },
};

function parseEntity(name: string): EntityDef | null {
  return Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ entity: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ success: false }, { status: 401 });

  const { entity } = await ctx.params;
  const def = parseEntity(entity);
  if (!def) return NextResponse.json({ success: false, error: "entitas tidak dikenal" }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);

  const db = getDb();
  const args: unknown[] = [];
  let whereSql = "";
  if (q && def.searchable?.length) {
    const clauses = def.searchable.map((col) => {
      args.push(`%${q}%`);
      return `CAST(${col} AS TEXT) LIKE ?`;
    });
    whereSql = `WHERE ${clauses.join(" OR ")}`;
  }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM ${def.table} ${whereSql}`).get(...args) as { c: number }).c;
  const rows = db
    .prepare(`SELECT ${def.columns.join(", ")} FROM ${def.table} ${whereSql} ORDER BY ${def.orderBy} LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);

  return NextResponse.json({
    success: true,
    data: { entity, total, limit, offset, deletable: !!def.deletable, rows },
  });
}

/** DELETE — hanya untuk entitas bertanda deletable (mis. force-logout sesi). */
export async function DELETE(req: Request, ctx: { params: Promise<{ entity: string }> }) {
  const session = await requireAdminSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: session ? 403 : 401 });
  }
  const store = await cookies();
  if (!verifyCsrf(session, req.headers.get("x-csrf-token"), store.get(CSRF_COOKIE)?.value)) {
    return NextResponse.json({ success: false, error: "CSRF token tidak valid" }, { status: 403 });
  }

  const { entity } = await ctx.params;
  const def = parseEntity(entity);
  if (!def?.deletable) {
    return NextResponse.json({ success: false, error: "entitas tidak dapat dihapus via browser" }, { status: 400 });
  }

  const url = new URL(req.url);
  const confirm = url.searchParams.get("confirm");
  const id = url.searchParams.get("id") ?? "";
  if (confirm !== entity || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return NextResponse.json({ success: false, error: "konfirmasi atau id tidak valid" }, { status: 422 });
  }

  const idColumn = def.columns.includes("id") ? "id" : "viewer_id";
  const result = getDb().prepare(`DELETE FROM ${def.table} WHERE ${idColumn} = ?`).run(id);
  logAudit({
    actor: session.username,
    action: "admin.db.delete",
    entityType: entity,
    entityId: id,
    details: { deleted: result.changes },
    ip: clientIp(req.headers),
  });
  return NextResponse.json({ success: true, data: { deleted: result.changes } });
}
