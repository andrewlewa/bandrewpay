import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "provrefresh-")), "test.db");

const { getDb, closeDb } = await import("../../src/db/index.ts");
const { saveSession } = await import("../../src/lib/payments/gojek.ts");
const {
  isRefreshDue,
  nextRefreshAtMs,
  getRefreshStatus,
} = await import("../../src/lib/payments/provider-refresh.ts");
const { setSetting } = await import("../../src/lib/config-store.ts");
getDb();

function sessionUpdatedAgo(msAgo: number): void {
  saveSession({
    phone_number: "+6285119772671",
    merchant_id: "123",
    outlet_name: "Test Outlet",
    access_token: "a".repeat(20),
    refresh_token: "r".repeat(20),
    cookie: null,
    updated_at: new Date(Date.now() - msAgo).toISOString(),
    expires_at: null,
  });
}

test("isRefreshDue: false saat tidak ada sesi", () => {
  assert.equal(isRefreshDue(), false);
  assert.equal(nextRefreshAtMs(), null);
});

test("isRefreshDue: true jika updated_at > 6 jam; false jika baru", () => {
  const H = 3_600_000;
  sessionUpdatedAgo(7 * H);
  assert.equal(isRefreshDue(), true);
  assert.ok(nextRefreshAtMs()! <= Date.now());

  sessionUpdatedAgo(1 * H);
  assert.equal(isRefreshDue(), false);
  const next = nextRefreshAtMs()!;
  assert.ok(next > Date.now() && next <= Date.now() + 5.01 * H);
});

test("getRefreshStatus membaca marker dari settings", () => {
  assert.equal(getRefreshStatus(), null);
  setSetting("provider_refresh_status", { ok: false, at: new Date().toISOString(), error: "x" });
  const st = getRefreshStatus();
  assert.equal(st?.ok, false);
  assert.equal(st?.error, "x");
});

closeDb();
