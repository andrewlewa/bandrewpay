import { after, describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../src/db/index.ts";
import {
  insertTransaction,
  transitionTransaction,
  findPendingByOrderId,
  getTransaction,
  listTransactions,
  acquireCheckSlot,
  IdempotentConflictError,
} from "../../src/lib/payments/transactions-repo.ts";
import { canTransition } from "../../src/lib/payments/state-machine.ts";
import { tryClaimProviderTx } from "../../src/lib/payments/verifier.ts";
import { hashPassword, verifyPassword } from "../../src/lib/auth/password.ts";

process.env.DATABASE_PATH = ":memory:";

before(() => {
  getDb(); // singleton :memory: dipakai semua modul repo di proses test ini
});

after(() => {
  closeDb();
});

function makeTx(orderId: string) {
  return insertTransaction({
    order_id: orderId,
    amount: 50_000,
    payable_amount: 50_000,
    qris_payload: "000201010211020891234567853033605802ID6304ABCD",
    integration_id: null,
    callback_url: null,
    redirect_url: null,
    customer_name: null,
    customer_email: null,
    expires_at: Date.now() + 300_000,
  });
}

describe("transactions-repo", () => {
  it("idempoten terhadap order PENDING yang sama", () => {
    const a = makeTx("ORDER-IDEM-1");
    assert.throws(() => makeTx("ORDER-IDEM-1"), IdempotentConflictError);
    const found = findPendingByOrderId("ORDER-IDEM-1");
    assert.equal(found?.id, a.id);
  });

  it("CAS: hanya satu pemenang transisi", () => {
    const tx = makeTx("ORDER-CAS-1");
    const first = transitionTransaction(tx.id, "PENDING", "PAID", { paid_amount: tx.amount });
    assert.equal(first, true);
    const second = transitionTransaction(tx.id, "PENDING", "EXPIRED");
    assert.equal(second, false);
    assert.equal(getTransaction(tx.id)?.status, "PAID");
  });

  it("transisi ilegal ditolak oleh state machine", () => {
    assert.equal(canTransition("PAID", "PENDING"), false);
    assert.equal(canTransition("EXPIRED", "PAID"), false);
    assert.equal(canTransition("PENDING", "PAID"), true);
    assert.equal(canTransition("PENDING", "CANCELLED"), true);
  });

  it("filter list bekerja", () => {
    makeTx("ORDER-LIST-9");
    const { items, total } = listTransactions({ status: "PENDING" });
    assert.ok(total >= 2);
    assert.ok(items.every((t) => t.status === "PENDING"));
  });

  it("acquireCheckSlot men-throttle interval", () => {
    const tx = makeTx("ORDER-SLOT-1");
    assert.equal(acquireCheckSlot(tx.id, 60_000), true);
    assert.equal(acquireCheckSlot(tx.id, 60_000), false);
  });
});

describe("claims (proteksi double-payment persisten)", () => {
  it("klaim pertama menang; pemilik lain di-skip", () => {
    const a = makeTx("ORDER-CLAIM-A");
    const b = makeTx("ORDER-CLAIM-B");
    assert.equal(tryClaimProviderTx(a.id, "PROV-TX-1"), "claimed");
    assert.equal(tryClaimProviderTx(b.id, "PROV-TX-1"), "taken");
    assert.equal(tryClaimProviderTx(a.id, "PROV-TX-1"), "mine");
  });
});

describe("kode unik payable_amount (anti-bentrok nominal sama)", () => {
  it("dua transaksi PENDING nominal dasar sama -> payable berbeda, selisih 1..100", async () => {
    // Template QRIS statis valid (CRC16 benar) untuk generateDynamicQris.
    const { calculateCRC16 } = await import("../../src/lib/payments/crc16.ts");
    const tlv = (tag: string, value: string) => `${tag}${value.length.toString().padStart(2, "0")}${value}`;
    const body =
      tlv("00", "01") + tlv("01", "11") +
      tlv("26", tlv("00", "COM.GO-JEK.WWW") + tlv("01", "936009143658712345")) +
      tlv("52", "5144") + tlv("53", "360") + tlv("58", "ID") +
      tlv("59", "UNIT TEST") + tlv("60", "JAKARTA");
    process.env.QRIS_STATIC = `${body}6304${calculateCRC16(`${body}6304`)}`;
    process.env.APP_URL ??= "http://localhost:4100";

    const { createPayment } = await import("../../src/lib/payments/service.ts");
    const a = await createPayment({ order_id: "UNIQ-A", amount: 12_500, currency: "IDR" }, null);
    const b = await createPayment({ order_id: "UNIQ-B", amount: 12_500, currency: "IDR" }, null);
    assert.ok(a.ok && b.ok, `create gagal: ${!a.ok ? a.error : !b.ok ? b.error : ""}`);
    if (!a.ok || !b.ok) return;

    const pa = a.transaction.payable_amount;
    const pb = b.transaction.payable_amount;
    assert.notEqual(pa, pb, "dua PENDING aktif tidak boleh punya nominal QRIS sama");
    for (const p of [pa, pb]) {
      assert.ok(p > 12_500 && p <= 12_600, `payable ${p} harus amount + 1..100`);
    }
    // amount dasar tetap untuk integrator/callback.
    assert.equal(a.transaction.amount, 12_500);
    assert.equal(b.transaction.amount, 12_500);

    // Payload QRIS benar-benar menyimpan nominal unik (tag 54).
    assert.ok(b.transaction.qris_payload!.includes(`54${String(pb).length.toString().padStart(2, "0")}${pb}`));
  });

  it("isPayableAmountActive: aktif saat PENDING, bebas setelah PAID", async () => {
    const { isPayableAmountActive } = await import("../../src/lib/payments/transactions-repo.ts");
    const tx = insertTransaction({
      order_id: "ORDER-UNIQ-FREE",
      amount: 77_700,
      payable_amount: 77_777,
      qris_payload: "000201010211020891234567853033605802ID6304ABCD",
      integration_id: null,
      callback_url: null,
      redirect_url: null,
      customer_name: null,
      customer_email: null,
      expires_at: Date.now() + 300_000,
    });
    assert.equal(isPayableAmountActive(77_777), true, "harus terdeteksi terpakai selagi PENDING");
    transitionTransaction(tx.id, "PENDING", "PAID", { paid_amount: 77_700 });
    assert.equal(isPayableAmountActive(77_777), false, "setelah PAID nominal boleh dipakai lagi");
  });
});

describe("password scrypt", () => {
  it("hash + verifikasi benar/salah", () => {
    const stored = hashPassword("rahasia-ku-yang-panjang");
    assert.notEqual(stored, "rahasia-ku-yang-panjang");
    assert.equal(verifyPassword("rahasia-ku-yang-panjang", stored), true);
    assert.equal(verifyPassword("salah", stored), false);
    assert.equal(verifyPassword("x", "format-rusak"), false);
  });
});
