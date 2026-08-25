import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

let _db: Db | null = null;

/**
 * Membuka (atau mengembalikan singleton) koneksi SQLite.
 * - WAL mode untuk concurrency baca/tulis yang lebih baik.
 * - foreign_keys ON agar FK benar-benar dipaksa.
 * - busy_timeout mencegah SQLITE_BUSY saat tick coordinator bersamaan dengan request.
 */
export function getDb(dbPath?: string): Db {
  if (_db) return _db;
  const resolved = dbPath ?? process.env.DATABASE_PATH ?? "./data/gateway.db";
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  migrate(db, path.resolve(process.cwd(), "src/db"));
  _db = db;
  return db;
}

/** Untuk testing: database in-memory terpisah dari singleton. */
export function createTestDb(): Db {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db, path.resolve(process.cwd(), "src/db"));
  return db;
}

function migrate(db: Db, schemaDir: string) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`
  );
  const applied = new Set(
    (
      db.prepare("SELECT name FROM schema_migrations").all() as {
        name: string;
      }[]
    ).map((r) => r.name)
  );

  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const insert = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(schemaDir, file), "utf-8");
    // Buang baris komentar (bisa mengandung ';' yang merusak split), lalu pecah per statement.
    // PRAGMA foreign_keys tidak bisa diubah di dalam transaksi dan sudah di-set di koneksi.
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.toUpperCase().startsWith("PRAGMA"));
    db.transaction(() => {
      for (const stmt of statements) db.exec(stmt);
      insert.run(file, Date.now());
    })();
  }
}

/** Tutup koneksi (dipakai test & graceful shutdown). */
export function closeDb(): void {
  _db?.close();
  _db = null;
}
