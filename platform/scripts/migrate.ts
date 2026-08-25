/** Terapkan migrasi DB lalu keluar. */
import { getDb } from "../src/db/index.ts";

const db = getDb();
const applied = db.prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name").all();
console.log("Migrasi terpasang:");
for (const m of applied as Array<{ name: string; applied_at: number }>) {
  console.log(`  - ${m.name} (${new Date(m.applied_at).toISOString()})`);
}
