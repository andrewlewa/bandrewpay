# BandrewPay Platform — Arsitektur & Analisis Migrasi

Tanggal: 2026-08-23. Dokumen ini merangkum hasil audit sistem lama dan keputusan arsitektur platform baru. Sumber kebenaran audit: kode aktual di root repo (Express gateway) dan `old-script/` (gateway lama + plugin Paymenter lama) — bukan asumsi.

---

## 1. Ringkasan sistem eksisting

### 1.1 Gateway saat ini (root repo — Express)

| Aspek | Kondisi |
|---|---|
| Backend | Express 4, CommonJS, entry `server.js`, logic di `src/` |
| Frontend | Satu halaman HTML inline untuk `/qr/:id` (buyer) |
| Auth | API key tunggal (header/query), dibandingkan `!==` (bukan timing-safe) |
| State | **Full in-memory**: `qrisStore`, `claimedTransactions`, logs — hilang saat restart |
| DB | Tidak ada. Hanya file sesi `.GOPAY_SESI_JANGAN_DIHAPUS.json` |
| Provider | GoBiz/GoPay tidak resmi: OTP login CLI, refresh token, polling `merchant-analytics/v2` |
| Matching | amount + time-window + claim ledger per `trx_id` (first caller wins) |
| Webhook/Callback | Tidak ada (hanya polling) |
| Rate limit | Tidak ada |
| Admin | Tidak ada |

### 1.2 Gateway legacy (`old-script/payment gateway server/` — referensi saja)

- Express + EJS + MySQL (`payments` table: `trx_id, order_id, original_amount, unique_id, total_amount, status ENUM('pending','paid'), qris_image ...`).
- Provider berbeda: `autoft-orkut` (QRIS statis dikonversi + cek mutasi bank via `MutasiClient`).
- **Business logic yang layak dipertahankan**:
  - Pola *unique code*: `total_amount = original_amount + unique_id` agar mutasi bisa dicocokkan unik per transaksi. (Di platform baru, pencocokan GoBiz memakai claim-scoped matching per `trx_id` — fungsinya setara, jadi pola unique-code tidak dibawa.)
  - One-time signed check token (HMAC + TTL + burn-after-use) untuk membatasi pengecekan dari browser.
  - Per-trx check budget (max 10) + rate limit per IP.
  - Callback HMAC ke merchant setelah paid.
- Kelemahan fatal yang TIDAK boleh dibawa: QRIS PNG ditulis ke `public/qris/qris_<TRX>.png` (**path publik dapat ditebak**, artifact bocor lintas transaksi), signature HMAC tanpa timestamp (replay abadi), `verifySignature` pakai `===` biasa, IP whitelist dari header `X-Forwarded-For` yang bisa dipalsukan, callback fire-and-forget tanpa retry/idempotensi, kredensial dalam `config.json` plaintext, log menyimpan body mentah.

### 1.3 Plugin Paymenter lama (`old-script/paymenter-plugin/`)

Kontrak komunikasi (dipelajari, tidak disalin):
1. `pay($invoice)` → POST `{gateway}/api/create-payment` body `{order_id: "INV-{id}", amount, currency, customer_name, customer_email, callback_url, signature}` → respons `{success, payment_url}` → Livewire redirect buyer ke `payment_url`.
2. Setelah paid, gateway POST `{paymenter}/extensions/qrisgateway/webhook` `{order_id, status:"paid", amount, trx_id, signature}` → plugin tandai invoice paid + event `InvoicePaid`.

Kelemahan: signature = `HMAC(key, orderId.amount.key)` tanpa timestamp/nonce (replay), webhook tidak memvalidasi jumlah vs invoice, tidak ada idempotency key eksplisit (hanya cek `status === 'paid'`), secret dipakai sebagai bagian pesan.

---

## 2. Keputusan arsitektur platform baru

```
Paymenter ──(create, HMAC signed)──► BandrewPay Gateway (Next.js)
                                        │  SQLite = source of truth
                                        │  Monitor coordinator: 1 poller/transaksi aktif
 Buyer browser ──(heartbeat + status)──►│        │
                                        ▼        ▼
                                   GoBiz upstream (Bearer session, 401-retry-once)
                                        │ match + claim persist
                                        ▼
                              transaksi PENDING → PAID (CAS) ──► callback queue
                                                                        │ retry/backoff
                                                                        ▼
                                                            Paymenter webhook (HMAC+timestamp+event_id)
```

| Keputusan | Alasan |
|---|---|
| Next.js 16 App Router + React 19, TypeScript | Terbaru stabil saat implementasi (16.3.2, audit 0 vuln); Server Components mengurangi JS client |
| SQLite via `better-sqlite3` + SQL murni (tanpa ORM) | Skema relasional penuh (FK, index, partial unique index, transaksi, CAS `UPDATE ... WHERE status=`); sync API mudah diaudit; satu file `data/gateway.db` chmod 600 |
| Tanpa Redis | Deployment target single-instance (SQLite tidak bisa disharing antar instance secara aman). Koordinasi monitor memakai tabel lease di SQLite — benar untuk topologi ini; Redis hanya perlu jika suatu saat multi-instance |
| QRIS artifact hidup di DB, dirender on-the-fly (`/api/pay/[id]/qr.png`, pakai `qrcode` lokal) | Menghapus sepenuhnya masalah file lifecycle: tidak ada path filesystem yang bisa ditebak, tidak ada kiriman payload ke layanan QR pihak ketiga (perbaikan temuan #7 skill gateway-security) |
| Claim ledger (`claims` table) persisten | Memperbaiki temuan HIGH #2: restart tidak lagi membuka jendela double-delivery |
| Auth admin custom (scrypt + session DB + cookie HttpOnly) | Fungsionalitas native `node:crypto` cukup; tanpa dependensi auth eksternal |
| Integrasi Paymenter: HMAC-SHA256 bertimestamp + nonce + replay window | Perbaikan langsung atas skema signature legacy |
| Polling upstream hanya oleh coordinator (lease viewer) | Browser tidak pernah memicu panggilan provider; N viewer = 1 poller (aturan anti-ban akun merchant) |
| Countdown server-authoritative (`expires_at` UTC di DB; client hanya render + koreksi offset `server_now`) | Aturan #10 task |
| Sesi provider GoBiz tersimpan di SQLite (`provider_session`), login ulang via OTP dari dashboard (Admin > Sesi GoPay) | Menghapus ketergantungan file plaintext `.GOPAY_SESI_JANGAN_DIHAPUS.json` (file hanya bootstrap impor sekali). Port setia dari `login.js`: request OTP `goid/login/request` -> token `goid/token` -> info merchant `users/config`; header impersonasi disalin apa adanya. Rate-limit 3 permintaan OTP/15 menit (anti-ban nomor merchant); token tidak pernah dikirim ke klien/log |
| Semua konfigurasi runtime diatur dari dashboard (Admin > Pengaturan); `.env` hanya fallback/bootstrap | Urutan prioritas: **settings DB > env > default** (`config-store.ts` getter `effective*`). Interval monitor dibaca ulang tiap siklus (recursive `setTimeout`), jadi perubahan berlaku tanpa restart. Password admin juga bisa diganti dari dashboard (`POST /api/admin/password`, verifikasi password lama + cabut sesi lain). `DATABASE_PATH` & `GOPAY_SESSION_FILE` tetap env-only |

## 3. Skema ringkas

Lihat `src/db/schema.sql` (sumber kebenaran). Inti:

- `transactions` — status CHECK constraint, `UNIQUE(order_id) WHERE status='PENDING'` (idempotensi create), index `(status, expires_at)`.
- `claims` — proteksi double-payment persisten (PK `provider_tx_id`).
- `monitor_viewers` — lease heartbeat per viewer; coordinator `GROUP BY transaction_id`.
- `payment_events` — append-only (riwayat immutable).
- `callback_deliveries` + `callback_attempts` — outbox dengan retry backoff.
- `users`, `sessions`, `login_attempts`, `nonces`, `audit_logs`, `settings`, `api_credentials`, `provider_session`, `webhook_events`.

## 4. Transisi status

```
PENDING ──► PAID       (pembayaran terverifikasi provider)
PENDING ──► EXPIRED    (lewat expires_at; CAS oleh sweeper)
PENDING ──► FAILED     (kesalahan permanen / dibatalkan admin)
PAID/EXPIRED/FAILED    = terminal; tidak ada jalur balik.
```
Semua transisi lewat `transitionTransaction()` (compare-and-set + event + audit) di dalam satu DB transaction.

### 4.1 Kode unik nominal (`payable_amount`, migrasi 002)

Masalah legacy: dua transaksi dengan nominal dasar sama bisa saling klaim di upstream
(si A bayar duluan tapi terverifikasi sebagai si B). Solusi:

- Saat create, platform memilih `payable_amount = amount + acak(1..100)` yang **belum dipakai**
  transaksi PENDING aktif lain (indeks parsial `idx_pending_payable`).
- QRIS digenerate untuk `payable_amount` — dua QRIS aktif tidak pernah bernominal sama.
- Verifier mencocokkan mutasi upstream terhadap `payable_amount`; kolom `amount`
  (nominal dasar) tetap yang dilaporkan ke integrator/callback/webhook.
- Baris lama di-backfill `payable_amount = amount`.

## 5. Model ancaman utama & mitigasi

| Ancaman | Mitigasi |
|---|---|
| Replay request integrasi | Timestamp ±5 menit + nonce unik tersimpan (TTL) + HMAC atas `ts.bodyHash` |
| Webhook palsu ke Paymenter | Signature HMAC per-event + timestamp + `event_id` uuid untuk dedup |
| Double fulfillment | Idempotensi create (partial unique index), klaim persisten, CAS status, callback dedup `event_id` |
| IDOR buyer | Halaman bayar publik by-design (seperti kuitansi), tapi hanya expose field aman; artifact QR hanya untuk trx tersebut |
| Brute force login | Throttle progresif + lockout + catatan `login_attempts` |
| XSS/CSRF admin | React escaping, CSP strict (nonce), SameSite=Lax cookie, CSRF token double-submit untuk mutation API |
| SQL injection | 100% prepared statements |
| Secret leak | Env server-only (zod-validated), tidak ada `NEXT_PUBLIC_*` rahasia; log sanitizing |
