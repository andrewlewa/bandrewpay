-- 003: Multi-platform callbacks.
-- Setiap "aplikasi" integrasi (mis. satu per toko Paymenter) punya secret
-- sendiri + default callback/redirect URL. Secret disimpan plaintext di DB
-- (file DB chmod 600 — setara .env); TIDAK PERNAH dikirim ulang ke klien
-- setelah pembuatan/rotasi.
ALTER TABLE api_credentials ADD COLUMN secret TEXT NOT NULL DEFAULT '';
ALTER TABLE api_credentials ADD COLUMN callback_url TEXT;
ALTER TABLE api_credentials ADD COLUMN redirect_url TEXT;
