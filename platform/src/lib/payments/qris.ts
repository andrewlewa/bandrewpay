import { calculateCRC16 } from "./crc16.ts";

export type TlvTag = { tag: string; val: string };

/** Parse EMVCo TLV presisi tinggi (port dari implementasi teruji). */
export function parseTlv(payload: string): TlvTag[] | null {
  const tags: TlvTag[] = [];
  let i = 0;
  while (i < payload.length) {
    const tag = payload.substring(i, i + 2);
    const length = Number.parseInt(payload.substring(i + 2, i + 4), 10);
    if (Number.isNaN(length)) return null;
    const val = payload.substring(i + 4, i + 4 + length);
    tags.push({ tag, val });
    i += 4 + length;
  }
  return tags;
}

/**
 * Bangun QRIS dinamis EMVCo dari template statis + nominal.
 * Port 1:1 dari src/qris/dynamicQris.js (smoke-tested):
 * - buang CRC lama, tag 01 -> '12' (dynamic),
 * - injeksi tag 54 sebelum tag 58 bila belum ada,
 * - rebuild TLV + '6304' + checksum baru.
 */
export function generateDynamicQris(staticTemplate: string, amount: number): string | null {
  if (!staticTemplate || !Number.isFinite(amount) || amount <= 0) return null;
  let payload = staticTemplate.trim();

  const idx63 = payload.indexOf("6304");
  if (idx63 !== -1) {
    payload = payload.substring(0, idx63);
  }

  let tags: TlvTag[];
  try {
    const parsed = parseTlv(payload);
    if (!parsed || parsed.length === 0) return null;
    tags = parsed;
  } catch {
    return null;
  }

  const amountStr = Math.round(amount).toString();
  const newTags: TlvTag[] = [];
  let hasTag54 = false;

  for (const item of tags) {
    if (item.tag === "01") {
      newTags.push({ tag: "01", val: "12" });
    } else if (item.tag === "54") {
      newTags.push({ tag: "54", val: amountStr });
      hasTag54 = true;
    } else if (item.tag === "58" && !hasTag54) {
      newTags.push({ tag: "54", val: amountStr });
      hasTag54 = true;
      newTags.push(item);
    } else {
      newTags.push(item);
    }
  }
  if (!hasTag54) {
    newTags.push({ tag: "54", val: amountStr });
  }

  let result = "";
  for (const item of newTags) {
    const lenStr = item.val.length.toString().padStart(2, "0");
    result += `${item.tag}${lenStr}${item.val}`;
  }
  result += "6304";
  return result + calculateCRC16(result);
}

/** Validasi checksum payload QRIS (dipakai settings admin & tests). */
export function validateQrisChecksum(payload: string): boolean {
  const idx = payload.lastIndexOf("6304");
  if (idx === -1 || idx + 8 !== payload.length) return false;
  const body = payload.slice(0, idx + 4);
  const given = payload.slice(idx + 4);
  return calculateCRC16(body) === given.toUpperCase();
}
