import { getDb } from "../db/index.ts";

export type AuditInput = {
  actor: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
  ip?: string | null;
};

/** Tulis jejak audit append-only. Tidak pernah melempar error ke caller. */
export function logAudit(input: AuditInput): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (actor, action, entity_type, entity_id, details_json, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.actor,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.details === undefined ? null : JSON.stringify(input.details),
        input.ip ?? null,
        Date.now()
      );
  } catch (err) {
    console.error("[audit] gagal menulis audit log:", err);
  }
}
