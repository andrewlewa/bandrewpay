-- 002: kode unik anti-bentrok nominal sama.
-- payable_amount = nominal yang benar-benar dibayar pembeli (amount + kode unik 1..100).
-- Kolom `amount` tetap nominal dasar dari integrator/admin (dipakai di callback/webhook).
ALTER TABLE transactions ADD COLUMN payable_amount INTEGER NOT NULL DEFAULT 0;

-- Backfill baris lama: tanpa kode unik, payable == amount.
UPDATE transactions SET payable_amount = amount WHERE payable_amount = 0;

-- Lookup cepat untuk pengecekan bentrok antar transaksi PENDING.
CREATE INDEX IF NOT EXISTS idx_pending_payable
  ON transactions(payable_amount)
  WHERE status = 'PENDING';
