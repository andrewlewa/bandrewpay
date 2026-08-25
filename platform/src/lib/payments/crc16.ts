/**
 * Port dari src/qris/crc16.js — algoritma CRC16-CCITT (init 0xFFFF, poly 0x1021),
 * output hex uppercase 4 digit. Dipertahankan persis karena sudah tervalidasi
 * terhadap payload QRIS nyata (lihat npm run smoke di gateway legacy).
 */

export function calculateCRC16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
