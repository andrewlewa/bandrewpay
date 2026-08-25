import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "merchantid-")), "test.db");
delete process.env.GOPAY_MERCHANT_ID; // isolasi dari env dev box

const { getDb } = await import("../../src/db/index.ts");
const { getConfiguredMerchantId, normalizeGoPayMerchantId, setSetting } = await import(
  "../../src/lib/config-store.ts"
);
const { resetEnvCache } = await import("../../src/lib/env.ts");
getDb();

describe("normalizeGoPayMerchantId", () => {
  it("menambahkan prefix G pada angka polos", () => {
    assert.equal(normalizeGoPayMerchantId("566035778"), "G566035778");
  });
  it("menerima lowercase g dan spasi", () => {
    assert.equal(normalizeGoPayMerchantId(" g566035778 "), "G566035778");
  });
  it("bentuk kanonik tidak berubah", () => {
    assert.equal(normalizeGoPayMerchantId("G566035778"), "G566035778");
  });
  it("nilai tak wajar dilewatkan apa adanya (validator route yang menolak)", () => {
    assert.equal(normalizeGoPayMerchantId("abc"), "abc");
  });
});

describe("getConfiguredMerchantId kanonik (regresi 403 unauthorized merchant access)", () => {
  it("settings tanpa G tetap dikirim dengan G", () => {
    setSetting("gopay_merchant_id", "566035778");
    const eff = getConfiguredMerchantId();
    assert.equal(eff.value, "G566035778");
    assert.equal(eff.source, "settings");
  });
  it("env tanpa G juga dikanonisasi", () => {
    getDb().prepare("DELETE FROM settings WHERE key='gopay_merchant_id'").run();
    process.env.GOPAY_MERCHANT_ID = "566035779";
    resetEnvCache();
    const eff = getConfiguredMerchantId();
    assert.equal(eff.value, "G566035779");
    assert.ok(["env", "settings"].includes(eff.source));
  });
});
