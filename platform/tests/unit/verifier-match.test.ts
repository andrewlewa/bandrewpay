import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DB hermetic SEBELUM import modul aplikasi (pola wajib repo).
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "verifier-")), "test.db");

const { findMatchingRawTx, UPSTREAM_PAGE_SIZE, UPSTREAM_MAX_PAGES } = await import(
  "../../src/lib/payments/verifier.ts"
);

const NOW = Date.now();
const START = NOW - 10 * 60 * 1000;

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prov-tx-1",
    gross_amount: 5003700, // x100 dari Rp50.037
    transaction_time: new Date(NOW - 60_000).toISOString(),
    ...over,
  };
}

describe("findMatchingRawTx (matcher murni verifier)", () => {
  it("cocok setelah normalisasi x100", () => {
    const m = findMatchingRawTx([raw()], 50037, START);
    assert.ok(m);
  });

  it("skip nominal beda, terlalu lama, atau tanpa id", () => {
    assert.equal(findMatchingRawTx([raw({ gross_amount: 5000000 })], 50037, START), null);
    assert.equal(findMatchingRawTx([raw({ transaction_time: new Date(START - 1000).toISOString() })], 50037, START), null);
    const noId = raw();
    delete noId.id;
    assert.equal(findMatchingRawTx([noId], 50037, START), null);
  });

  it("fallback field: order_id / wallstreet_transaction_id & settlement_time / created_at", () => {
    const a = raw();
    delete a.id;
    a.order_id = "ORD-1";
    assert.ok(findMatchingRawTx([a], 50037, START));
    const b = raw();
    delete b.id;
    b.wallstreet_transaction_id = "WS-1";
    assert.ok(findMatchingRawTx([b], 50037, START));
    const c = raw({ transaction_time: undefined, settlement_time: new Date(NOW).toISOString() });
    assert.ok(findMatchingRawTx([c], 50037, START));
  });

  it("amount bisa berupa object {value} atau string", () => {
    assert.ok(findMatchingRawTx([raw({ gross_amount: undefined, amount: { value: "5003700" } })], 50037, START));
    assert.ok(findMatchingRawTx([raw({ gross_amount: undefined, amount: "5003700" })], 50037, START));
  });

  it("mengembalikan match PERTAMA pada daftar panjang (halaman penuh)", () => {
    const page = Array.from({ length: UPSTREAM_PAGE_SIZE }, (_, i) =>
      raw({ id: `tx-${i}`, gross_amount: i === UPSTREAM_PAGE_SIZE - 1 ? 5003700 : 111111 })
    );
    const m = findMatchingRawTx(page, 50037, START) as { id?: string };
    assert.equal(m?.id, `tx-${UPSTREAM_PAGE_SIZE - 1}`);
  });

  it("konstanta paging: size 20, maks 3 halaman (anti-ban, degradasi anggun)", () => {
    assert.equal(UPSTREAM_PAGE_SIZE, 20);
    // 3 halaman = 60 tx / window TTL 5 menit - cukup untuk lonjakan nyata,
    // sementara kegagalan halaman >=2 tidak boleh membuat cek error.
    assert.equal(UPSTREAM_MAX_PAGES, 3);
  });
});
