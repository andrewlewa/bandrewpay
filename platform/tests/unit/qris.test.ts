import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateCRC16 } from "../../src/lib/payments/crc16.ts";
import { generateDynamicQris, validateQrisChecksum, parseTlv } from "../../src/lib/payments/qris.ts";

function tlv(tag: string, value: string): string {
  return `${tag}${value.length.toString().padStart(2, "0")}${value}`;
}

/** Template statis sintetis yang valid (tanpa tag 54). */
function buildStaticTemplate(): string {
  const body =
    tlv("00", "01") +
    tlv("01", "11") + // static
    tlv("26", tlv("00", "COM.GO-JEK.WWW") + tlv("01", "936009143658712345")) +
    tlv("52", "5144") +
    tlv("53", "360") +
    tlv("58", "ID") +
    tlv("59", "MERCHANT TEST") +
    tlv("60", "JAKARTA");
  return `${body}6304${calculateCRC16(`${body}6304`)}`;
}

describe("CRC16 EMVCo", () => {
  it("deterministik, 4-char uppercase hex", () => {
    const crc = calculateCRC16("000201");
    assert.match(crc, /^[0-9A-F]{4}$/);
    assert.equal(crc, calculateCRC16("000201"));
  });
});

describe("generateDynamicQris", () => {
  it("mengubah static ke dynamic dan menyisipkan nominal", () => {
    const template = buildStaticTemplate();
    assert.ok(validateQrisChecksum(template), "template uji harus checksum valid");

    const dynamic = generateDynamicQris(template, 25_000);
    assert.ok(dynamic);
    assert.ok(validateQrisChecksum(dynamic!), "hasil dynamic harus checksum valid");
    assert.equal(parseTlv(dynamic!.replace(/6304[A-F0-9]{4}$/, ""))?.find((t) => t.tag === "01")?.val, "12");
    assert.equal(parseTlv(dynamic!.replace(/6304[A-F0-9]{4}$/, ""))?.find((t) => t.tag === "54")?.val, "25000");
    // Tag 54 harus sebelum tag 58
    assert.ok(dynamic!.indexOf("540525000") < dynamic!.indexOf("5802ID"));
  });

  it("menolak template rusak / nominal tidak valid", () => {
    assert.equal(generateDynamicQris("", 100), null);
    assert.equal(generateDynamicQris("XXYYZZ", 100), null);
    assert.equal(generateDynamicQris(buildStaticTemplate(), 0), null);
    assert.equal(generateDynamicQris(buildStaticTemplate(), -5), null);
    assert.equal(generateDynamicQris(buildStaticTemplate(), NaN), null);
  });
});
