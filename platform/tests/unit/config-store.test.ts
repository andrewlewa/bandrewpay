import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  effectiveAppUrl,
  effectivePaymentTtlSeconds,
  getSessionSecret,
  getIntegrationSecret,
  getConfiguredQrisStatic,
  setSetting,
  deleteSetting,
} from "../../src/lib/config-store.ts";
import { resetEnvCache } from "../../src/lib/env.ts";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "cfgstore-")), "test.db");
process.env.SESSION_SECRET = "";
delete process.env.INTEGRATION_SECRET;
delete process.env.QRIS_STATIC;
  resetEnvCache();
delete process.env.APP_URL;
delete process.env.PAYMENT_TTL_SECONDS;
  resetEnvCache();

const { getDb, closeDb } = await import("../../src/db/index.ts");
getDb();

function cleanup() {
  closeDb();
}

test("urutan prioritas: settings > env > default (angka)", () => {
  delete process.env.PAYMENT_TTL_SECONDS;
  resetEnvCache();
  let r = effectivePaymentTtlSeconds();
  assert.equal(r.value, 300);
  assert.equal(r.source, "default");

  process.env.PAYMENT_TTL_SECONDS = "600";
  resetEnvCache();
  r = effectivePaymentTtlSeconds();
  assert.equal(r.value, 600);
  assert.equal(r.source, "env");

  setSetting("payment_ttl_seconds", 900);
  r = effectivePaymentTtlSeconds();
  assert.equal(r.value, 900);
  assert.equal(r.source, "settings");

  // Nilai override di luar batas diabaikan -> jatuh ke env.
  setSetting("payment_ttl_seconds", 1);
  r = effectivePaymentTtlSeconds();
  assert.equal(r.source, "env");

  deleteSetting("payment_ttl_seconds");
  delete process.env.PAYMENT_TTL_SECONDS;
  resetEnvCache();
});

test("app_url: settings menimpa env, trailing slash dirapikan", () => {
  delete process.env.APP_URL;
  resetEnvCache();
  let r = effectiveAppUrl();
  assert.equal(r.source, "default");

  process.env.APP_URL = "https://from-env.example.com/";
  resetEnvCache();
  r = effectiveAppUrl();
  assert.equal(r.value, "https://from-env.example.com");
  assert.equal(r.source, "env");

  setSetting("app_url", "https://dash.example.com/pay/");
  r = effectiveAppUrl();
  assert.equal(r.value, "https://dash.example.com/pay");
  assert.equal(r.source, "settings");

  deleteSetting("app_url");
  delete process.env.APP_URL;
  resetEnvCache();
});

test("secret: env fallback dipakai hanya jika tidak ada override settings; generate sebagai upaya terakhir", () => {
  const gen = getIntegrationSecret();
  assert.equal(gen.source, "generated");
  const generatedValue = gen.value;

  process.env.INTEGRATION_SECRET = "e".repeat(40);
  assert.equal(getIntegrationSecret().source, "env");

  setSetting("integration_secret", "s".repeat(40));
  const s = getIntegrationSecret();
  assert.equal(s.source, "settings");

  deleteSetting("integration_secret");
  assert.equal(getIntegrationSecret().source, "env");
  delete process.env.INTEGRATION_SECRET;
  assert.equal(getIntegrationSecret().value, generatedValue);

  // session_secret sama polanya
  process.env.SESSION_SECRET = "x".repeat(40);
  assert.equal(getSessionSecret().source, "env");
  setSetting("session_secret", "y".repeat(48));
  assert.equal(getSessionSecret().source, "settings");
  deleteSetting("session_secret");
  delete process.env.SESSION_SECRET;
});

test("qris_static: settings > env > kosong", () => {
  const payload = `${"0".repeat(206)}6304ABCD`;
  process.env.QRIS_STATIC = payload;
  resetEnvCache();
  assert.deepEqual({ v: getConfiguredQrisStatic().value, s: getConfiguredQrisStatic().source }, {
    v: payload,
    s: "env",
  });
  setSetting("qris_static", `${"1".repeat(206)}6304ABCD`);
  assert.equal(getConfiguredQrisStatic().source, "settings");
  deleteSetting("qris_static");
  delete process.env.QRIS_STATIC;
  resetEnvCache();
  assert.equal(getConfiguredQrisStatic().value, "");
});

cleanup();
