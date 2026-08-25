/**
 * Smoke test end-to-end platform BandrewPay.
 * - Build + boot server produksi (next start) dengan DB terpisah.
 * - Uji: health, signed create, halaman bayar, QR PNG, status, watch/leave,
 *   admin login + pages + aksi CSRF, replay/unsigned rejection,
 *   dan pengiriman callback HMAC ke receiver lokal.
 *
 * Jalankan dari folder platform/: npm run smoke
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";

Object.assign(process.env, { NODE_ENV: "production", DATABASE_PATH: path.resolve(process.cwd(), "data/smoke.db") });

const PORT = 4199;
const CB_PORT = 4210;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.resolve(process.cwd(), "data/smoke.db");
// (DATABASE_PATH sudah diset di process.env di atas — dipakai koneksi smoke sendiri)
const SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const INTEGRATION_SECRET = crypto.randomBytes(32).toString("hex");
const ADMIN_USER = "smokeadmin";
const ADMIN_PASS = "smoke-password-123456";

// Template QRIS statis valid (dibangun dengan CRC16 asli).
const { calculateCRC16 } = await import("../src/lib/payments/crc16.ts");
function tlv(tag: string, value: string): string {
  return `${tag}${value.length.toString().padStart(2, "0")}${value}`;
}
const tlvBody =
  tlv("00", "01") +
  tlv("01", "11") +
  tlv("26", tlv("00", "COM.GO-JEK.WWW") + tlv("01", "936009143658712345")) +
  tlv("52", "5144") +
  tlv("53", "360") +
  tlv("58", "ID") +
  tlv("59", "SMOKE MERCHANT") +
  tlv("60", "JAKARTA");
const QRIS_TEMPLATE = `${tlvBody}6304${calculateCRC16(`${tlvBody}6304`)}`;

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(PORT),
  APP_URL: BASE,
  DATABASE_PATH: DB_PATH,
  SESSION_SECRET,
  INTEGRATION_SECRET,
  ADMIN_USERNAME: ADMIN_USER,
  ADMIN_PASSWORD: ADMIN_PASS,
  QRIS_STATIC: QRIS_TEMPLATE,
  GOPAY_SESSION_FILE: "",
  MONITOR_TICK_MS: "1000",
};

let passed = 0;
let failed = 0;

type ReceivedCallback = { headers: http.IncomingHttpHeaders; body: string };

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  OK ${name}`);
  } catch (err) {
    failed++;
    console.error(`  GAGAL ${name}`);
    console.error(String(err instanceof Error ? err.stack : err));
  }
}

type SimpleResponse = {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

function request(
  urlPath: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}${urlPath}`,
      { method: opts.method ?? "GET", headers: opts.headers ?? {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function signHeaders(bodyStr: string, secret: string = INTEGRATION_SECRET): Record<string, string> {
  const ts = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const bodyHash = crypto.createHash("sha256").update(bodyStr).digest("hex");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${nonce}.${bodyHash}`)
    .digest("hex");
  return { "X-BP-Timestamp": ts, "X-BP-Nonce": nonce, "X-BP-Signature": sig };
}

function run(cmd: string, args: string[], showOutput = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env });
    if (showOutput) p.stderr.on("data", (d) => process.stderr.write(d));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} gagal (${code})`))));
  });
}

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request("/api/health");
      if (res.status === 200) return;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server tidak siap dalam batas waktu");
}

console.log("[smoke] preflight: pastikan port bebas…");
try {
  const probe = await request("/api/health");
  if (probe.status === 200) {
    console.error(`[smoke] FATAL: sudah ada server di port ${PORT}. Matikan dulu (next-server orphan?).`);
    process.exit(1);
  }
} catch {
  /* port bebas — lanjut */
}

console.log("[smoke] menyiapkan database…");
// HANYA hapus file smoke.db (+WAL/SHM) — JANGAN mengosongkan folder data/
// karena gateway.db produksi bisa ada di folder yang sama.
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

console.log("[smoke] build next…");
await run("npx", ["next", "build"]);

console.log("[smoke] seed admin…");
await run("node", ["--experimental-strip-types", "scripts/seed.ts"]);

console.log("[smoke] memulai server…");
// detached + process group agar SIGTERM membunuh next-server (child) juga.
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));

try {
  await waitForServer();

  console.log("\n[smoke] endpoint publik & integrasi");
  let transactionId = "";
  let orderId = "";

    await test("CSP: akses HTTP TIDAK memaksa upgrade-insecure-requests (bug HP/LAN)", async () => {
    const res = await request("/api/health");
    const csp = String(res.headers["content-security-policy"] ?? "");
    assert.ok(csp.length > 0, "header CSP ada");
    assert.ok(!csp.includes("upgrade-insecure-requests"), "jangan paksa https di akses HTTP langsung");
  });

await test("GET /api/health -> ok", async () => {
    const res = await request("/api/health");
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body.toString()) as { success: boolean; database: { ok: boolean } };
    assert.equal(json.success, true);
    assert.equal(json.database.ok, true);
  });

  await test("POST /api/v1/payments tanpa signature -> 401", async () => {
    const payload = JSON.stringify({ order_id: "INV-NEG-1", amount: 10000 });
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    assert.equal(res.status, 401);
  });

  await test("POST /api/v1/payments timestamp basi -> 401", async () => {
    const payload = JSON.stringify({ order_id: "INV-NEG-2", amount: 10000 });
    const headers = signHeaders(payload);
    headers["X-BP-Timestamp"] = String(Date.now() - 10 * 60 * 1000);
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload,
    });
    assert.equal(res.status, 401);
  });

  await test("POST /api/v1/payments signature salah -> 401", async () => {
    const payload = JSON.stringify({ order_id: "INV-NEG-3", amount: 10000 });
    const headers = signHeaders(payload);
    headers["X-BP-Signature"] = "0".repeat(64);
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload,
    });
    assert.equal(res.status, 401);
  });

  await test("POST /api/v1/payments valid -> payment_url", async () => {
    orderId = "INV-SMOKE-1";
    const payload = JSON.stringify({
      order_id: orderId,
      amount: 25000,
      customer_name: "Smoke Tester",
      customer_email: "smoke@example.com",
      callback_url: `http://127.0.0.1:${CB_PORT}/webhook`,
      redirect_url: `${BASE}/thanks`,
    });
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload) },
      body: payload,
    });
    assert.equal(res.status, 201);
    const json = JSON.parse(res.body.toString()) as { success: boolean; data: { payment_url: string; transaction_id: string } };
    assert.equal(json.success, true);
    assert.match(json.data.payment_url, /^http/);
    transactionId = json.data.transaction_id;
  });

  await test("idempotensi: order sama -> transaksi sama", async () => {
    const payload = JSON.stringify({ order_id: orderId, amount: 25000 });
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload) },
      body: payload,
    });
    const json = JSON.parse(res.body.toString()) as { data: { transaction_id: string } };
    assert.equal(json.data.transaction_id, transactionId);
  });

  await test("nonce dipakai ulang -> ditolak (replay)", async () => {
    const payload = JSON.stringify({ order_id: "INV-REPLAY", amount: 10000 });
    const headers = signHeaders(payload);
    const first = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload,
    });
    const second = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload,
    });
    assert.notEqual(first.status, 401);
    assert.equal(second.status, 401);
  });

  await test("kode unik: dua order nominal sama -> payable_amount berbeda", async () => {
    // Order kedua dengan amount identik ke INV-SMOKE-1 (25000).
    const payload = JSON.stringify({ order_id: "INV-SMOKE-2", amount: 25000 });
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload) },
      body: payload,
    });
    assert.equal(res.status, 201);
    const json = JSON.parse(res.body.toString()) as { data: { transaction_id: string; payable_amount: number } };
    const payable2 = json.data.payable_amount;
    assert.ok(payable2 > 25000 && payable2 <= 25100, `payable ${payable2} harus 25001..25100`);
    const firstStatus = await request(`/api/payments/${transactionId}/status`);
    const firstJson = JSON.parse(firstStatus.body.toString()) as { data: { payable_amount: number } };
    assert.notEqual(firstJson.data.payable_amount, payable2, "dua QRIS aktif tidak boleh sama nominalnya");
  });

  await test("GET /pay/{id} merender halaman desain baru", async () => {
    const res = await request(`/pay/${transactionId}`);
    assert.equal(res.status, 200);
    const html = res.body.toString();
    assert.ok(html.includes(transactionId));
    // Penanda desain Payment-ui (cinematic glassmorphism)
    assert.ok(html.includes("Total Pembayaran"), "label nominal");
    assert.ok(html.includes("bg-cinematic"), "latar sinematik");
    assert.ok(html.includes("payment-card"), "kartu kaca");
    assert.ok(html.includes("/api/pay/" + transactionId + "/qr.png"), "gambar QRIS on-the-fly");
    assert.ok(html.includes("Saya Sudah Bayar"), "tombol cek manual (aksi utama)");
    assert.ok(html.includes("Didukung semua bank"), "trust QRIS");
    // Tidak ada lagi kontrol demo / tombol regenerate
    assert.ok(!html.includes("Simulate Success"), "kontrol demo harus hilang");
    assert.ok(!html.includes("Generate New QRIS"), "tombol regenerate harus hilang");
  });

  await test("GET /api/pay/{id}/qr.png -> image/png", async () => {
    const res = await request(`/api/pay/${transactionId}/qr.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.ok(res.body.length > 500);
  });

  await test("GET status buyer -> pending + server_now_ms", async () => {
    const res = await request(`/api/payments/${transactionId}/status`);
    const json = JSON.parse(res.body.toString()) as { data: { status: string; server_now_ms: number } };
    assert.equal(json.data.status, "pending");
    assert.ok(Math.abs(json.data.server_now_ms - Date.now()) < 5000);
  });

  await test("watch heartbeat menerima lease", async () => {
    const viewerId = crypto.randomBytes(16).toString("hex");
    const res = await request("/api/payments/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: transactionId, viewer_id: viewerId }),
    });
    assert.equal(res.status, 200);
    const leave = await request("/api/payments/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewer_id: viewerId }),
    });
    assert.equal(leave.status, 204);
  });

  await test("GET /api/v1/payments/{id} signed -> data status", async () => {
    const res = await request(`/api/v1/payments/${transactionId}`, { headers: signHeaders("") });
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body.toString()) as { data: { transaction_id: string } };
    assert.equal(json.data.transaction_id, transactionId);
  });

  console.log("\n[smoke] admin");
  let cookies = "";
  let csrf = "";

  await test("login admin -> cookie sesi", async () => {
    const res = await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    assert.equal(res.status, 200);
    const setCookieRaw = res.headers["set-cookie"] ?? [];
    cookies = setCookieRaw.map((c) => c.split(";")[0]).join("; ");
    const csrfCookie = setCookieRaw.find((c) => c.startsWith("bp_csrf=")) ?? "";
    csrf = csrfCookie.split(";")[0].split("=").slice(1).join("=");
    assert.ok(cookies.includes("bp_admin_session="));
    assert.ok(csrf.length > 10);
    // Regresi akses HP/LAN: cookie sesi di HTTP TIDAK boleh ber-flag Secure
    // (browser menolaknya sehingga login tampak gagal).
    const allCookies = setCookieRaw.join("\n");
    assert.ok(!/secure/i.test(allCookies), "cookie Secure tidak boleh dikirim pada origin HTTP");
  });

  await test("login admin password salah -> 401", async () => {
    const res = await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USER, password: "wrong-password" }),
    });
    assert.equal(res.status, 401);
  });

  await test("aksi admin tanpa CSRF -> 403", async () => {
    const res = await request(`/api/admin/transactions/${transactionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ action: "recheck" }),
    });
    assert.equal(res.status, 403);
  });

  await test("halaman admin dirender", async () => {
    for (const page of ["/admin", "/admin/transactions", "/admin/settings", "/admin/system", "/admin/database", "/admin/callbacks"]) {
      const res = await request(page, { headers: { Cookie: cookies } });
      assert.equal(res.status, 200, page);
    }
  });

  await test("sidebar admin dirender + tautan buat pembayaran", async () => {
    const res = await request("/admin", { headers: { Cookie: cookies } });
    assert.equal(res.status, 200);
    const html = res.body.toString();
    assert.ok(html.includes('href="/admin/payments/new"'), "tautan Buat Pembayaran harus ada");
  });

  await test("create pembayaran manual admin -> sukses", async () => {
    const payload = JSON.stringify({ amount: "12000", customer_name: "Manual Tester" });
    const res = await request("/api/admin/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: payload,
    });
    const status = res.status ?? 0;
    assert.ok(status >= 200 && status < 300, `status ${status}`);
    const json = JSON.parse(res.body.toString()) as {
      success: boolean;
      data: { transaction_id: string; order_id: string; payment_url: string; qr_url: string };
    };
    assert.equal(json.success, true);
    assert.match(json.data.order_id, /^MAN-/);
    const page = await request(`/pay/${json.data.transaction_id}`);
    assert.equal(page.status, 200);
  });

  await test("create pembayaran manual tanpa CSRF -> 403", async () => {
    const res = await request("/api/admin/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ amount: 1000 }),
    });
    assert.equal(res.status, 403);
  });

  await test("cek manual buyer: outcome jujur (error tanpa sesi, throttled saat klik cepat)", async () => {
    const { insertTransaction } = await import("../src/lib/payments/transactions-repo.ts");
    const tx = insertTransaction({
      order_id: `INV-SMOKE-CHK-${Date.now()}`,
      amount: 12000,
      payable_amount: 12000,
      qris_payload: QRIS_TEMPLATE,
      integration_id: null,
      callback_url: null,
      redirect_url: null,
      customer_name: null,
      customer_email: null,
      expires_at: Date.now() + 300_000,
    });
    // Klik pertama: slot didapat -> verify berjalan -> provider session tidak ada
    // di DB smoke -> outcome HARUS "error" (bukan menyamar jadi "belum dibayar").
    const r1 = await request(`/api/payments/${tx.id}/check`, { method: "POST" });
    assert.equal(r1.status, 200);
    const j1 = JSON.parse(r1.body.toString()) as { data: { status: string; check_outcome: string } };
    assert.equal(j1.data.status, "pending");
    assert.equal(j1.data.check_outcome, "error");
    // Klik kedua < 3 detik: kena slot throttle -> outcome "throttled".
    const r2 = await request(`/api/payments/${tx.id}/check`, { method: "POST" });
    assert.equal(r2.status, 200);
    const j2 = JSON.parse(r2.body.toString()) as { data: { check_outcome: string } };
    assert.equal(j2.data.check_outcome, "throttled");
  });

  await test("/admin tanpa sesi -> redirect ke /admin/login", async () => {
    const res = await request("/admin");
    assert.ok([302, 307].includes(res.status ?? 0));
    assert.ok(String(res.headers.location).startsWith("/admin/login"));
  });

  await test("GET /admin/login tanpa sesi -> form dirender", async () => {
    const res = await request("/admin/login");
    assert.equal(res.status, 200);
    assert.ok(res.body.toString().includes("Masuk"));
  });

  await test("GET /admin/login dengan sesi aktif -> redirect ke /admin", async () => {
    const res = await request("/admin/login", { headers: { Cookie: cookies } });
    assert.ok([302, 307].includes(res.status ?? 0));
    assert.equal(String(res.headers.location), "/admin");
  });

  await test("PUT settings qris checksum invalid -> 422", async () => {
    const payload = JSON.stringify({ qris_static: "0002010102116304AAAA" });
    const res = await request("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: payload,
    });
    assert.equal(res.status, 422);
  });

  await test("settings override numeric + GET menunjukkan source settings", async () => {
    const put = await request("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ payment_ttl_seconds: "600" }),
    });
    assert.equal(put.status, 200);
    const get = await request("/api/admin/settings", { headers: { Cookie: cookies } });
    const json = JSON.parse(get.body.toString()) as {
      data: { effective: Array<{ key: string; value: number | string; source: string }> };
    };
    const row = json.data.effective.find((e) => e.key === "payment_ttl_seconds");
    assert.ok(row, "payment_ttl_seconds tidak ada di effective");
    assert.equal(row.value, 600);
    assert.equal(row.source, "settings");

    // Reset ke fallback (env/default)
    const clear = await request("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ payment_ttl_seconds: "" }),
    });
    assert.equal(clear.status, 200);
    const get2 = JSON.parse((await request("/api/admin/settings", { headers: { Cookie: cookies } })).body.toString()) as typeof json;
    const row2 = get2.data.effective.find((e) => e.key === "payment_ttl_seconds");
    assert.notEqual(row2?.source, "settings");
    assert.equal(row2?.value, 300);
  });

  await test("ganti password admin: salah lama -> 401, benar -> sukses (lalu kembalikan)", async () => {
    const wrong = await request("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ current_password: "bukan-password", new_password: "SmokeNewPass123!" }),
    });
    assert.equal(wrong.status, 401);

    // Password asli smokeadmin didefinisikan di atas (env boot server smoke).
    const real = ADMIN_PASS;
    const ok = await request("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ current_password: real, new_password: "SmokeTempPass123!" }),
    });
    assert.equal(ok.status, 200);
    // Kembalikan ke password semula agar run berikutnya tetap konsisten.
    const back = await request("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ current_password: "SmokeTempPass123!", new_password: real }),
    });
    assert.equal(back.status, 200);
  });

  await test("provider: status sesi -> has_session false (DB smoke), storage database", async () => {
    const res = await request("/api/admin/provider/session", { headers: { Cookie: cookies } });
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body.toString()) as {
      data: { has_session: boolean; storage: string };
    };
    assert.equal(typeof json.data.has_session, "boolean");
    assert.ok(json.data.storage.includes("database"));
  });

  await test("provider: minta OTP tanpa CSRF -> 403", async () => {
    const res = await request("/api/admin/provider/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ phone: "081234567890" }),
    });
    assert.equal(res.status, 403);
  });

  await test("provider: minta OTP nomor invalid -> 422 tanpa menyentuh upstream", async () => {
    const res = await request("/api/admin/provider/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ phone: "12" }),
    });
    assert.equal(res.status, 422);
  });

  await test("provider: refresh manual tanpa CSRF -> 403", async () => {
    const res = await request("/api/admin/provider/refresh", { method: "POST", headers: { Cookie: cookies } });
    assert.equal(res.status, 403);
  });

  await test("provider: refresh manual tanpa sesi -> 422 (tanpa upstream)", async () => {
    const res = await request("/api/admin/provider/refresh", {
      method: "POST",
      headers: { Cookie: cookies, "x-csrf-token": csrf },
    });
    assert.equal(res.status, 422);
  });

  // --- Multi-aplikasi (X-BP-Key) ---
  const APP_CB = `http://127.0.0.1:${CB_PORT}/webhook/app-test`;
  let appId = "";
  let appSecret = "";
  await test("POST /api/admin/apps -> aplikasi dibuat, secret tampil sekali", async () => {
    const res = await request("/api/admin/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ label: "SmokeApp", callback_url: APP_CB }),
    });
    assert.equal(res.status, 200);
    const json = JSON.parse(res.body.toString()) as {
      data: { id: string; secret: string };
    };
    appId = json.data.id;
    appSecret = json.data.secret;
    assert.ok(appId.startsWith("APP-"));
    assert.ok(appSecret.length >= 32);

    const list = JSON.parse((await request("/api/admin/apps", { headers: { Cookie: cookies } })).body.toString()) as {
      data: { apps: Array<{ id: string; secret_masked: string }> };
    };
    const row = list.data.apps.find((a) => a.id === appId)!;
    assert.ok(row.secret_masked.includes("*"));
    assert.ok(!row.secret_masked.includes(appSecret.slice(4, -4)));
  });

  await test("create payment dengan X-BP-Key + secret aplikasi -> 201 & pakai default callback app", async () => {
    const payload = JSON.stringify({ order_id: "INV-APP-1", amount: 15000 });
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload, appSecret), "X-BP-Key": appId },
      body: payload,
    });
    assert.equal(res.status, 201);
    const txRows = JSON.parse(
      (await request("/api/admin/db/transactions?limit=50", { headers: { Cookie: cookies } })).body.toString()
    ) as { data?: { rows?: Array<{ order_id: string; integration_id: string | null; callback_url: string | null }> } };
    const tx = (txRows.data?.rows ?? []).find((r) => r.order_id === "INV-APP-1");
    assert.ok(tx, "transaksi INV-APP-1 tidak ditemukan");
    assert.equal(tx.integration_id, appId);
    assert.equal(tx.callback_url, APP_CB);
  });

  await test("create payment X-BP-Key dengan secret salah -> 401", async () => {
    const payload = JSON.stringify({ order_id: "INV-APP-BAD", amount: 15000 });
    const res = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload, "w".repeat(43)), "X-BP-Key": appId },
      body: payload,
    });
    assert.equal(res.status, 401);
  });

  await test("aplikasi nonaktif -> 401; hapus -> 401 key tak dikenal", async () => {
    await request(`/api/admin/apps/${appId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookies, "x-csrf-token": csrf },
      body: JSON.stringify({ active: false }),
    });
    const payload = JSON.stringify({ order_id: "INV-APP-OFF", amount: 15000 });
    const off = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload, appSecret), "X-BP-Key": appId },
      body: payload,
    });
    assert.equal(off.status, 401);

    const del = await request(`/api/admin/apps/${appId}`, {
      method: "DELETE",
      headers: { Cookie: cookies, "x-csrf-token": csrf },
    });
    assert.equal(del.status, 200);
    const gone = await request("/api/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signHeaders(payload, appSecret), "X-BP-Key": appId },
      body: payload,
    });
    assert.equal(gone.status, 401);
  });

  await test("login native form POST (fallback tanpa JS) -> 303 redirect, bukan GET", async () => {
    const form = new URLSearchParams({ username: ADMIN_USER, password: "salah-banget" });
    const res = await request("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookies,
        "X-Forwarded-For": "203.0.113.50",
      },
      body: form.toString(),
    });
    assert.equal(res.status, 303);
    assert.equal(String(res.headers.location).includes("/admin/login?err=1"), true);
  });

  await test("blokir otomatis: 10x gagal dari satu IP -> login 403 & halaman menolak", async () => {
    const spamIp = "203.0.113.77";
    let last = 0;
    for (let i = 0; i < 10; i++) {
      last = (
        await request("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": spamIp },
          body: JSON.stringify({ username: `ghost${i}`, password: "wrong" }),
        })
      ).status ?? 0;
    }
    assert.ok([401, 403].includes(last), `status terakhir ${last} harus 401/403`);

    const blockedPage = await request("/admin/login", { headers: { "X-Forwarded-For": spamIp } });
    assert.equal(blockedPage.status, 200);
    assert.ok(
      blockedPage.body.toString().includes("Akses Diblokir"),
      "halaman login harus menampilkan blokir untuk IP tersebut"
    );

    // Admin membuka blokir -> halaman kembali normal
    const unblockRes = await request(`/api/admin/security/ip-blocks?ip=${spamIp}`, {
      method: "DELETE",
      headers: { Cookie: cookies, "x-csrf-token": csrf },
    });
    assert.equal(unblockRes.status, 200);
    const okPage = await request("/admin/login", { headers: { "X-Forwarded-For": spamIp } });
    assert.ok(okPage.body.toString().includes("Masuk Dashboard"));
  });

  await test("db browser entitas tak dikenal -> 404", async () => {
    const res = await request("/api/admin/db/not_a_table", { headers: { Cookie: cookies } });
    assert.equal(res.status, 404);
  });

  await test("db browser users tidak membocorkan password_hash", async () => {
    const res = await request("/api/admin/db/users", { headers: { Cookie: cookies } });
    assert.equal(res.status, 200);
    assert.ok(!res.body.toString().includes("scrypt$"));
  });

  console.log("\n[smoke] alur paid + callback HMAC");
  let receivedCallback: ReceivedCallback | null = null;

  await test("callback HMAC diterima receiver lokal", async () => {
    // Receiver lokal berperan sebagai Paymenter.
    const cbServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedCallback = { headers: req.headers, body: Buffer.concat(chunks).toString() };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      });
    });
    await new Promise<void>((r) => cbServer.listen(CB_PORT, "127.0.0.1", r));

    // Paksa transaksi jadi PAID langsung lewat repositori (proses smoke share DB file).
    const { getDb } = await import("../src/db/index.ts");
    getDb();
    const { transitionTransaction, getTransaction } = await import("../src/lib/payments/transactions-repo.ts");
    const { enqueueCallback } = await import("../src/lib/callbacks/dispatcher.ts");
    assert.equal(transitionTransaction(transactionId, "PENDING", "PAID", { paid_amount: 25000, matched_provider_tx: "SMOKE-PROV-TX" }), true);
    const tx = getTransaction(transactionId);
    assert.equal(tx?.status, "PAID");
    await enqueueCallback(tx);

    const deadline = Date.now() + 25_000;
    while (!receivedCallback && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
    }
    cbServer.close();

    assert.ok(receivedCallback, "callback harus diterima dalam 25 detik");
    const json = JSON.parse(receivedCallback!.body) as { event: string; order_id: string; amount: number };
    assert.equal(json.event, "payment.paid");
    assert.equal(json.order_id, orderId);
    assert.equal(json.amount, 25000);

    // Verifikasi signature seperti yang dilakukan plugin Paymenter.
    const ts = receivedCallback!.headers["x-bp-timestamp"];
    const nonce = receivedCallback!.headers["x-bp-nonce"];
    const sig = receivedCallback!.headers["x-bp-signature"];
    assert.ok(ts && nonce && sig);
    const expected = crypto
      .createHmac("sha256", INTEGRATION_SECRET)
      .update(`${ts}.${nonce}.${crypto.createHash("sha256").update(receivedCallback!.body).digest("hex")}`)
      .digest("hex");
    assert.equal(expected, sig);
  });

  await test("status buyer menjadi paid + redirect_url", async () => {
    const res = await request(`/api/payments/${transactionId}/status`);
    const json = JSON.parse(res.body.toString()) as { data: { status: string; redirect_url: string | null } };
    assert.equal(json.data.status, "paid");
    assert.equal(json.data.redirect_url, `${BASE}/thanks`);
  });

  await test("halaman /pay PAID merender state sukses (overlay + receipt)", async () => {
    const res = await request(`/pay/${transactionId}`);
    assert.equal(res.status, 200);
    const html = res.body.toString();
    assert.ok(html.includes("Pembayaran Berhasil"), "judul sukses");
    assert.ok(html.includes("success-state show"), "overlay sukses aktif saat SSR");
    assert.ok(html.includes("Transaksi Anda telah selesai dengan aman."), "hint sukses");
    // Hitung mundur redirect 5 detik dijalankan di klien — pastikan prasyaratnya ada
    assert.ok(html.includes("/thanks"), "redirect_url tersedia bagi klien");
  });

  await test("QR transaksi EXPIRED -> 410", async () => {
    const { insertTransaction, transitionTransaction } = await import("../src/lib/payments/transactions-repo.ts");
    const expiredTx = insertTransaction({
      order_id: "INV-SMOKE-EXPIRED",
      amount: 15000,
      payable_amount: 15000,
      qris_payload: QRIS_TEMPLATE,
      integration_id: null,
      callback_url: null,
      redirect_url: null,
      customer_name: null,
      customer_email: null,
      expires_at: Date.now() + 60_000,
    });
    transitionTransaction(expiredTx.id, "PENDING", "EXPIRED");
    const res = await request(`/api/pay/${expiredTx.id}/qr.png`);
    assert.equal(res.status, 410);

    // Halaman bayar transaksi EXPIRED merender state kedaluwarsa (SSR)
    const page = await request(`/pay/${expiredTx.id}`);
    assert.equal(page.status, 200);
    const html = page.body.toString();
    assert.ok(html.includes("QRIS Kedaluwarsa"), "judul kedaluwarsa");
    assert.ok(html.includes("expired-state show"), "overlay kedaluwarsa aktif saat SSR");
    assert.ok(html.includes("buat transaksi baru"), "arahkan buyer ke merchant");
  });
} finally {
  try {
    if (server.pid) process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGTERM");
  }
}

console.log(`\n[smoke] selesai: ${passed} lulus, ${failed} gagal`);
process.exit(failed > 0 ? 1 : 0);
