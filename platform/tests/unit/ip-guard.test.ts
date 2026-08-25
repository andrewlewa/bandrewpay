import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "ipguard-")), "test.db");

const { getDb, closeDb } = await import("../../src/db/index.ts");
const {
  isIpBlocked,
  autoBlockIfAbusive,
  upsertBlock,
  listBlocks,
  unblockIp,
  isValidIp,
} = await import("../../src/lib/auth/ip-guard.ts");
getDb();

function seedFailures(ip: string, n: number, ageMs = 60_000): void {
  const ins = getDb().prepare(
    "INSERT INTO login_attempts (username, ip, successful, attempted_at) VALUES ('ghost', ?, 0, ?)"
  );
  const now = Date.now();
  for (let i = 0; i < n; i++) ins.run(ip, now - ageMs - i);
}

test("tanpa kegagalan -> tidak ada blokir otomatis", () => {
  assert.equal(isIpBlocked("10.0.0.1"), null);
  assert.equal(autoBlockIfAbusive("10.0.0.1"), null);
});

test("3x gagal berturut-turut -> blokir PERMANEN; sukses mereset hitungan", () => {
  // Dua kegagalan lalu satu SUKSES -> hitungan reset, belum blokir
  const ins = getDb().prepare(
    "INSERT INTO login_attempts (username, ip, successful, attempted_at) VALUES ('ghost', ?, ?, ?)"
  );
  ins.run("10.0.0.6", 0, Date.now() - 3000);
  ins.run("10.0.0.6", 0, Date.now() - 2000);
  ins.run("10.0.0.6", 1, Date.now() - 1000);
  ins.run("10.0.0.6", 0, Date.now());
  assert.equal(autoBlockIfAbusive("10.0.0.6"), null);

  // Tiga gagal langsung tanpa sukses -> permanen
  seedFailures("10.0.0.2", 3);
  const block = autoBlockIfAbusive("10.0.0.2");
  assert.ok(block, "harus terblokir");
  assert.equal(block!.expires_at, null);
  assert.equal(!!isIpBlocked("10.0.0.2"), true);
});

test("blokir kedaluwarsa diabaikan; manual permanen & unblock", () => {
  upsertBlock({ ip: "10.0.0.4", reason: "uji", blocked_at: Date.now(), expires_at: Date.now() - 1000 });
  assert.equal(isIpBlocked("10.0.0.4"), null); // kedaluwarsa

  upsertBlock({ ip: "10.0.0.5", reason: "manual", blocked_at: Date.now(), expires_at: null });
  assert.equal(!!isIpBlocked("10.0.0.5"), true);
  assert.equal(listBlocks().some((b) => b.ip === "10.0.0.5"), true);
  assert.equal(unblockIp("10.0.0.5"), true);
  assert.equal(isIpBlocked("10.0.0.5"), null);
  assert.equal(unblockIp("10.0.0.tidakada"), false);
});

test("validator IP", () => {
  assert.equal(isValidIp("192.168.1.111"), true);
  assert.equal(isValidIp("8.8.8.8"), true);
  assert.equal(isValidIp("999.1.1.1"), false);
  assert.equal(isValidIp("fe80::1"), true);
  assert.equal(isValidIp("bukan-ip"), false);
});

closeDb();
