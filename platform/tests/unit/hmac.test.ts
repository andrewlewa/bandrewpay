import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { checkSignature, computeSignature } from "../../src/lib/hmac.ts";
import { timingSafeEqualStr, sha256Hex } from "../../src/lib/ids.ts";

const SECRET = "unit-test-secret-0123456789abcdef";

describe("checkSignature (HMAC v2)", () => {
  it("menerima signature yang benar dalam window", () => {
    const ts = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const body = JSON.stringify({ hello: "world" });
    const sig = computeSignature(SECRET, ts, nonce, body);
    const result = checkSignature(SECRET, { timestampMs: ts, nonce, signature: sig, body });
    assert.deepEqual(result, { ok: true });
  });

  it("menolak timestamp basi (replay lama)", () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const nonce = "n2";
    const body = "{}";
    const result = checkSignature(SECRET, {
      timestampMs: ts,
      nonce,
      signature: computeSignature(SECRET, ts, nonce, body),
      body,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "skew");
  });

  it("menolak body yang dimodifikasi", () => {
    const ts = Date.now();
    const nonce = "n3";
    const result = checkSignature(SECRET, {
      timestampMs: ts,
      nonce,
      signature: computeSignature(SECRET, ts, nonce, '{"a":1}'),
      body: '{"a":2}',
    });
    assert.equal(result.ok, false);
  });

  it("menolak field hilang / format salah", () => {
    assert.equal(checkSignature(SECRET, {}).ok, false);
    assert.equal(
      checkSignature(SECRET, { timestampMs: Number("abc"), nonce: "x", signature: "x", body: "" }).ok,
      false
    );
  });

  it("secret salah ditolak", () => {
    const ts = Date.now();
    const nonce = "n5";
    const body = "x";
    assert.equal(
      checkSignature(SECRET + "X", { timestampMs: ts, nonce, signature: computeSignature(SECRET, ts, nonce, body), body }).ok,
      false
    );
  });
});

describe("ids utils", () => {
  it("timingSafeEqualStr konsisten", () => {
    assert.equal(timingSafeEqualStr("a".repeat(64), "a".repeat(64)), true);
    assert.equal(timingSafeEqualStr("a".repeat(64), "b".repeat(64)), false);
    assert.equal(timingSafeEqualStr("short", "longer-string"), false);
  });
  it("sha256Hex stabil", () => {
    assert.equal(sha256Hex("abc"), crypto.createHash("sha256").update("abc").digest("hex"));
  });
});
