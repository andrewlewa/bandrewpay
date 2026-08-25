# BandrewPay — Paymenter Extension (v1.1.1)

Gateway QRIS untuk Paymenter yang terhubung ke platform BandrewPay (Next.js + SQLite).

## Instalasi

1. Salin folder `BandrewPay/` ke `extensions/` pada instalasi Paymenter.
2. Di admin Paymenter → Extensions, aktifkan **BandrewPay**.
3. Isi konfigurasi:
   - **URL Gateway BandrewPay** — base URL platform (mis. `https://pay.domainmu.com`).
   - **Integration Secret** — secret dari aplikasi terdaftar di dashboard
     **BandrewPay > Aplikasi** (disarankan), atau `INTEGRATION_SECRET` global lama.
     Minimal 32 karakter.
   - **ID Aplikasi (X-BP-Key)** — ID aplikasi (`APP-xxxx`) dari dashboard BandrewPay.
     Wajib bila Anda memakai multi-aplikasi; kosongkan untuk secret global lama.
   - **Redirect Link Setelah Bayar** — opsional. Kosongkan = otomatis ke halaman
     invoice Paymenter. Kosongkan = kembali ke halaman invoice Paymenter
     (`/invoices/{id}` — angka id, bukan label INV-{id}). Isi jika ingin
     buyer diarahkan ke halaman lain.
   - **URL Paymenter** — opsional; kosongkan untuk auto-detect.

### Setup multi-aplikasi (disarankan)

1. Dashboard BandrewPay → **Aplikasi** → *Tambah Aplikasi*: isi label + default
   callback URL webhook toko ini.
2. Salin **secret** yang tampil sekali itu ke config plugin ini, dan **ID Aplikasi**
   ke field `X-BP-Key`.
3. Callback pembayaran untuk toko ini otomatis ditandatangani dengan secret
   aplikasinya sendiri — toko lain tidak bisa memvalidasi callback milikmu.

## Alur pembayaran

```
Invoice dibuat → pay() POST {gateway}/api/v1/payments  (HMAC v2 headers + X-BP-Key)
              → buyer diarahkan ke payment_url (/pay/TRX-…)
Pembayaran terdeteksi koordinator → invoice paid via callback:
POST {paymenter}/extensions/bandrewpay/webhook (HMAC v2 + timestamp + nonce)
```

## Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| `cURL error 7: Failed to connect` saat bayar, padahal gateway online dari luar | **Hairpin NAT**: Paymenter & gateway di server yang sama, domain publik tak terjangkau dari dalam. Tambahkan di `/etc/hosts` server: `127.0.0.1 pay.domainmu.com dashboard.domainmu.com` |
| Gateway menolak `"signature tidak cocok"` | Pastikan plugin **v1.1.1+** (bug encode body lama) dan nilai *Integration Secret* identik dengan secret aplikasi di BandrewPay › Aplikasi (tanpa spasi/baris baru). Isi juga *ID Aplikasi (X-BP-Key)* |
| Invoice lunas tapi status web tidak update | Cek callback URL transaksi menunjuk ke domain Paymenter yang benar; isi config **URL Paymenter** eksplisit agar callback selalu tepat |

## Keamanan webhook

- Signature: `HMAC_SHA256(secret, "{ts}.{nonce}.{sha256(rawBody)}")` pada header
  `X-BP-Timestamp`, `X-BP-Nonce`, `X-BP-Signature`.
- Timestamp harus dalam ±5 menit; nonce ditolak bila sudah pernah dipakai (cache 11 menit).
- Nominal diverifikasi sama dengan total invoice; event dedup via `event_id`.
