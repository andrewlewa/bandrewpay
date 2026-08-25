-- 004: Blokir IP untuk halaman/API login admin.
-- Diisi otomatis (threshold kegagalan per-IP) atau manual dari dashboard
-- (Admin > Keamanan). expires_at NULL = blokir permanen.
CREATE TABLE IF NOT EXISTS ip_blocks (
  ip          TEXT PRIMARY KEY,
  reason      TEXT NOT NULL DEFAULT 'manual',
  blocked_at  INTEGER NOT NULL,
  expires_at  INTEGER
);
