/**
 * Seed awal: buat admin pertama + pastikan integration secret ada.
 * Jalankan sekali: npm run seed
 */
import fs from "node:fs";
import { getDb } from "../src/db/index.ts";
import { countUsers, upsertUser } from "../src/lib/auth/login.ts";
import { getIntegrationSecret, hasExplicitIntegrationSecret } from "../src/lib/config-store.ts";

const db = getDb();

// Perketat permission file database.
try {
  const row = db.pragma("database_list") as Array<{ name: string; file: string }>;
  const file = row.find((r) => r.name === "main")?.file;
  if (file && fs.existsSync(file)) {
    fs.chmodSync(file, 0o600);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${file}${suffix}`;
      if (fs.existsSync(sidecar)) fs.chmodSync(sidecar, 0o600);
    }
    console.log(`[seed] chmod 600 -> ${file}`);
  }
} catch (err) {
  console.warn("[seed] gagal set permission DB:", err instanceof Error ? err.message : err);
}

if (countUsers() === 0) {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!username || password.length < 8) {
    console.error("[seed] ADMIN_USERNAME/ADMIN_PASSWORD wajib diisi (password min 8 karakter) saat DB masih kosong.");
    process.exit(1);
  }
  upsertUser({ username, password, role: "admin" });
  console.log(`[seed] admin "${username}" dibuat.`);
} else {
  console.log("[seed] user sudah ada — dilewati (gunakan dashboard untuk kelola user).");
}

if (!hasExplicitIntegrationSecret()) {
  const secret = getIntegrationSecret(); // generate + persist
  console.log("\n========================================================");
  console.log("Integration secret BARU telah dibuat. Salin ke plugin Paymenter:");
  console.log(`\n    ${secret}\n`);
  console.log("(Tidak akan ditampilkan lagi; ubah via dashboard bila perlu.)");
  console.log("========================================================\n");
} else {
  console.log("[seed] integration secret sudah tersedia (env/settings).");
}
