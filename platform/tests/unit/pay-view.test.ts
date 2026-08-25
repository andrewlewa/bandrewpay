import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REDIRECT_DELAY_SECONDS, formatRupiah, formatRemaining, redirectCountdownText } from "../../src/lib/payments/pay-view.ts";

describe("formatRupiah", () => {
  it("memformat gaya id-ID tanpa desimal", () => {
    assert.equal(formatRupiah(125000), "Rp 125.000");
    assert.equal(formatRupiah(1000), "Rp 1.000");
    assert.equal(formatRupiah(37), "Rp 37");
    assert.equal(formatRupiah(0), "Rp 0");
  });
});

describe("formatRemaining", () => {
  it("mm:ss dasar", () => {
    assert.equal(formatRemaining(9 * 60_000 + 42_000), "09:42");
    assert.equal(formatRemaining(65_000), "01:05");
    assert.equal(formatRemaining(5_000), "00:05");
  });
  it("tepat habis & negatif -> 00:00", () => {
    assert.equal(formatRemaining(0), "00:00");
    assert.equal(formatRemaining(-1234), "00:00");
    assert.equal(formatRemaining(999), "00:00"); // <1 detik dibulatkan ke bawah
  });
});

describe("redirectCountdownText", () => {
  it("null saat belum mulai", () => {
    assert.equal(redirectCountdownText(null), null);
  });
  it("menampilkan sisa detik", () => {
    assert.match(redirectCountdownText(5)!, /5 detik/);
    assert.match(redirectCountdownText(1)!, /1 detik/);
  });
  it("fase navigasi saat 0", () => {
    assert.equal(redirectCountdownText(0), "Mengarahkan…");
  });
  it("konstanta jeda = 5 detik (kebutuhan produk)", () => {
    assert.equal(REDIRECT_DELAY_SECONDS, 5);
  });
});
