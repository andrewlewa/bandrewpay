import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, maskPhone } from "../../src/lib/payments/provider-login.ts";

test("normalizePhone: 08xx, +62xx, 62xx, spasi/dash dibuang", () => {
  assert.equal(normalizePhone("085119772671"), "85119772671");
  assert.equal(normalizePhone("+62 851-1977-2671"), "85119772671");
  assert.equal(normalizePhone("6285119772671"), "85119772671");
  assert.equal(normalizePhone("081"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("abc"), null);
});

test("maskPhone menyembunyikan digit tengah", () => {
  const masked = maskPhone("+6285119772671");
  assert.ok(masked.startsWith("+62"));
  assert.ok(masked.includes("*"));
  assert.ok(masked.endsWith("2671"));
  assert.ok(!masked.includes("85119772"));
});
