/** Impor sesi GoPay dari file legacy ke SQLite: npm run import-session [path] */
import { importSessionFromFile } from "../src/lib/payments/gojek.ts";
import { getDb } from "../src/db/index.ts";

getDb(); // pastikan migrasi jalan
const result = importSessionFromFile(process.argv[2]);
if (result.imported) {
  console.log("[import-session] Sesi berhasil diimpor ke database.");
} else {
  console.error(`[import-session] Gagal: ${result.reason}`);
  process.exit(1);
}
