# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/); versi mengikuti
[SemVer](https://semver.org/). **Aturan: setiap fitur/perubahan perilaku baru WAJIB
dicatat di sini + README terkait diperbarui.**

## [Unreleased]

### 2026-08-26 — Plugin v1.1.1: redirect balik ke halaman invoice yang benar

- *Fixed* — Default `redirect_url` kini `/invoices/{id}` (bentuk kanonik
  route Livewire Paymenter; binding numerik). Sebelumnya `/invoice/{id}`
  (singular) yang tidak terdaftar -> buyer berpotensi 404 setelah hitung
  mundur 5 detik. Label `INV-{id}` tetap tampil sebagai nomor di halaman.

### 2026-08-26 — Pulihkan CHANGELOG + dokumentasi debugging deployment

- *Fixed* — CHANGELOG.md tidak sengaja tertimpa konten README plugin pada
  commit sebelumnya; dipulihkan utuh dari riwayat git.
- *Docs* — README plugin: bagian **Troubleshooting** (hairpin NAT `/etc/hosts`,
  "signature tidak cocok", callback domain salah) + bump versi v1.1.1.
- *Docs* — README utama: contoh **vhost nginx hardened** untuk nginx ≥1.25
  (`http2 on;`, tanpa duplikasi direktif SSL dari include certbot), catatan
  hairpin NAT multi-app satu server, dan blok anti-probe `Next-Action`.

### 2026-08-26 — Fix login dari HP/LAN: cookie sesi tak lagi ber-flag Secure di HTTP

- *Fixed* — `sessionCookieOptions` memakai `secure: NODE_ENV==="production"`;
  pada deployment produksi atas HTTP langsung, browser modern MENOLAK cookie
  berflag Secure sehingga login valid di server (terbukti di login_attempts)
  tetapi sesi tak pernah tersimpan — buyer/admin tampak gagal masuk.
  Kini flag `secure` ADAPTIF terhadap protokol request aktual
  (`requestIsHttps`: x-forwarded-proto / URL), konsisten dengan fix CSP;
  berlaku untuk cookie sesi & CSRF.
- *Tests* — Smoke +1 asersi: Set-Cookie login pada origin HTTP tanpa flag
  Secure (total 45).

### 2026-08-26 — Fix akses HP/LAN: browser tak lagi dipaksa HTTPS

- *Fixed* — Direktif CSP `upgrade-insecure-requests` sebelumnya aktif di semua
  build produksi, membuat browser meng-upgrade paksa `http://` -> `https://`
  sehingga aplikasi tidak bisa dibuka dari HP di jaringan lokal (tanpa TLS).
  Kini direktif hanya aktif bila request memang datang lewat HTTPS
  (`x-forwarded-proto`/protokol aktual) — otomatis menyesuaikan deployment
  di balik proxy maupun LAN langsung, tanpa konfigurasi tambahan.
- *Tests* — Smoke +1: asersi header CSP pada akses HTTP bebas direktif tsb
  (total 45).

### 2026-08-26 — Sistem animasi dashboard admin

- *Added* — Motion system menyeluruh (menghormati `prefers-reduced-motion`):
  - **Transisi antar-halaman**: setiap navigasi admin memutar fade-up halus
    (`RouteTransition` keyed by pathname, easing cubic-bezier(0.22,1,0.36,1)).
  - **Stagger konten**: kartu/section pada semua halaman (Ringkasan,
    Transaksi, Callback, Sistem, Sesi GoPay, Aplikasi, Keamanan, Database,
    Pengaturan, Buat Pembayaran, Detail transaksi) muncul berurutan dengan
    delay bertingkat.
  - **Sidebar**: drawer mobile kini selalu ter-mount — buka/tutup dianimasikan
    slide + fade backdrop dengan easing premium (bukan muncul instan),
    ditambah tombol X di dalam drawer; sidebar desktop mendapat entrance
    slide lembut saat load pertama.

### 2026-08-26 — Fix struktural mobile: topbar admin & Ringkasan

- *Fixed* — **Sidebar/topbar**: sebelumnya `<header>` mobile menjadi anak
  flex-row layout sehingga tampil sebagai kolom sempit di KIRI konten.
  Kini topbar `fixed` setinggi 14 (h-14) selebar layar, flex-row hanya aktif
  mulai `lg:`, dan konten diberi `pt-14 lg:pt-0` — bar penuh di atas, konten
  lebar penuh di bawahnya.
- *Polished* — **Ringkasan**: kartu statistik padding responsif
  (`p-3.5 sm:p-5`) + label/value bertingkat dengan `truncate` + `tabular-nums`
  (nominal panjang tak meluber), grid gap mengecil di mobile, spacing halaman
  & panel Status Monitor/Terbaru adaptif.

### 2026-08-26 — Responsivitas mobile dashboard admin

- *Fixed* — Perbaikan menyeluruh tampilan mobile Admin:
  - **Tabel** (Transaksi/Callback/Ringkasan): kolom prioritas rendah
    disembunyikan bertingkat di layar kecil (`md:` / `lg:` / `sm:`), padding &
    font tabel dipadatkan khusus <640px — tanpa lagi kolom tergencet.
  - **Toolbar Transaksi**: judul & form pencarian menumpuk rapi di mobile,
    input pencarian full-width.
  - **Kartu statistik Ringkasan**: nilai rupiah memakai `text-xl` di mobile
    (tak overflow), `text-2xl` mulai sm.
  - **Baris label-nilai** (Sistem/Sesi GoPay/detail transaksi): gap-6 -> gap-3
    di mobile; input OTP lebih ramping (tracking 0.25em) supaya tak meluber.
  - **Drawer menu mobile**: body scroll dikunci saat terbuka, bisa ditutup
    dengan Escape, dan topbar kini menampilkan nama halaman aktif.
  - **Lainnya**: tombol aksi kartu Aplikasi wrap; heading detail transaksi
    break-all untuk ID panjang; padding kartu login adaptif; main content
    px/py lebih rapat di mobile; anti auto-zoom iOS (input >=16px).
- Validasi: tsc bersih, build sukses, unit 56/56, smoke 44/44.

### 2026-08-26 — ROOT CAUSE "pembayaran tak terverifikasi": merchant_id tanpa prefix G (403)

Diagnosa realtime: 1 pembayaran test dibuat & dibayar nyata; log upstream
menunjukkan seluruh panggilan analytics gagal `HTTP 403
"unauthorized merchant access"` meski sesi fresh.

- *Root cause* — settings DB menyimpan `566035778` (tanpa prefix G, karena
  validasi dashboard lama menolak "G"), sementara upstream mensyaratkan bentuk
  kanonik `G566035778`. Precedence settings > env membuat nilai rusak menang.
- *Fixed* — `normalizeGoPayMerchantId()` baru di config-store:
  - read-side (`getConfiguredMerchantId`) selalu mengkanonikalisasi
    settings/env ke bentuk berprefix G;
  - Admin › Pengaturan kini menerima kedua bentuk & menyimpan kanonik;
  - nilai tersimpan diperbaiki langsung di DB produksi.
- *Added* — Logging diagnostik upstream ter-gate env `DEBUG_PROVIDER=1`
  (HTTP status, param, jumlah item, sample field netral — tanpa token).
- *Verified live* — Setelah fix: poll pertama -> HTTP 200 -> pembayaran test
  Rp10.001 otomatis MATCHED -> PAID (claims ledger terisi). Unit +6 (total 56),
  smoke 44/44.

### 2026-08-26 — Paging upstream anti-rentan: degradasi anggun + batas 3 halaman

- *Fixed* — Efek samping paging kemarin: transaksi yang belum ditemukan di
  halaman 1 memicu pengecekan hingga 10 halaman per siklus, dan kegagalan
  fetch halaman lanjutan membuat seluruh cek dilaporkan "Gagal menghubungi
  provider" walau provider sehat. Sekarang:
  - paging hanya berlanjut bila halaman sebelumnya **penuh** (indikator ada
    kelanjutan data) — transaksi normal kembali 1 request;
  - batas diturunkan 10 -> **3 halaman** (60 tx / window TTL 5 menit);
  - kegagalan halaman >=2 **tidak** menjadikan cek gagal (log warn +
    lanjut dengan hasil terkumpul -> STILL_PENDING); hanya kegagalan halaman 1
    yang benar-benar dilaporkan sebagai error provider.

### 2026-08-26 — Fix tombol "Saya Sudah Bayar": pagination upstream + pesan jujur

- *Fixed* — Verifikator kini melakukan **paging** terhadap endpoint transaksi
  GoBiz (`from` bertahap, size 20 x maks 10 halaman, berhenti saat cocok).
  Sebelumnya hanya halaman pertama (20 tx) yang diperiksa sehingga pada
  merchant ramai pembayaran buyer bisa tidak pernah ditemukan walau sudah
  dibayar ("Belum ada pembayaran masuk" selamanya). Kasus umum tetap
  1 request upstream.
- *Fixed* — Pesan hasil cek manual kini JUJUR per `check_outcome`: `throttled`
  -> "Baru saja diperiksa, tunggu 3 detik"; `in_flight` -> pemeriksaan masih
  berjalan; `error` (sesi provider mati/upstream gagal) -> "Gagal menghubungi
  provider". Hanya `still_pending` yang benar-benar berarti belum ada
  pembayaran masuk.
- *Added* — Matcher murni `findMatchingRawTx()` diekstrak + 6 unit test baru;
  smoke baru memverifikasi outcome error/throttled tanpa menyentuh upstream.

### 2026-08-26 — Seluruh skill `.opencode` disinkronkan dengan platform

- *Changed* — 10 SKILL.md ditulis ulang agar platform-first (sebelumnya
  berbasis gateway legacy Express): overview arsitektur Next.js+SQLite,
  konvensi route handler (envelope, HMAC v2, CSRF), halaman bayar /pay baru
  (desain sinematik + jeda redirect 5 detik), panduan persistensi/migrasi
  SQLite, kontrak integrasi API v1 untuk toko, postur keamanan saat ini
  (temuan legacy ditandai FIXED), runbook debugging & operasi platform,
  referensi upstream GoBiz dengan sesi di SQLite, dan QRIS/CRC16 dengan path
  platform. Pengetahuan legacy tetap tersedia namun di-scope ke `reference/`.
- Validasi frontmatter: 10/10 OK (nama=folder, deskripsi <=1024 char).

### 2026-08-26 — Halaman bayar /pay: desain sinematik baru + jeda redirect 5 detik

- *Changed* — Halaman pembeli `/pay/{trxId}` didesain ulang mengadopsi desain
  `Payment-ui/`: latar aurora sinematik + grid + noise, kartu kaca dengan border
  gradien animasi & refleksi berjalan, efek tilt 3D (non-sentuh, hormati
  reduced-motion), frame QRIS bercahaya dengan border konik berputar + scan aura,
  badge aman berdenyut, trust strip, serta state overlay sukses (centang SVG
  teranimasi) dan kedaluwarsa.
- *Added* — Setelah status PAID, buyer menunggu **5 detik** dengan hitung mundur
  terlihat ("Anda akan diarahkan dalam N detik…" + progress bar) sebelum
  dialihkan ke `redirect_url`. Tanpa `redirect_url`, layar sukses tetap tampil
  tanpa navigasi.
- *Kept* — Seluruh perilaku lama utuh: polling status 5 detik ke endpoint DB,
  heartbeat lease 10 detik (+ leave beacon), countdown server-authoritative
  (offset server_now_ms), tombol "Saya Sudah Bayar" (aksi utama anti-ban),
  salin nominal, hint kode unik, nama pembeli, state FAILED/CANCELLED.
- *Adaptasi CSP* — Ikon lucide diganti inline SVG; font Plus Jakarta Sans tetap
  self-host via next/font. Tanpa resource eksternal baru.
- *Tests* — Helper tampilan diekstrak ke `src/lib/payments/pay-view.ts` +
  7 unit test baru (total 44). Smoke bertambah asersi desain/state SSR
  (total 43).

### 2026-08-26 — AGENTS.md ditulis ulang

- *Changed* — `AGENTS.md` dibuat ulang (file lama sudah dihapus manual): fokus
  di platform aktif, perintah developer terverifikasi (termasuk `npx tsc
  --noEmit` karena tidak ada script typecheck, dan cara menjalankan satu file
  test), gotcha toolchain, invariant uang & auth, aturan secrets/workflow,
  catatan legacy `reference/`, dan daftar skills.

### 2026-08-26 — README total rewrite untuk GitHub

- *Changed* — `README.md` ditulis ulang sepenuhnya berfokus pada BandrewPay:
  banner + badge, fitur utama (12 poin), diagram arsitektur & alur pembayaran
  (mermaid), state machine transaksi, model keamanan (tabel ancaman→mitigasi +
  rumus HMAC v2), quick start, tabel konfigurasi dengan aturan precedence,
  API reference v1 + webhook keluar, panduan plugin Paymenter, tur dashboard,
  testing (37 unit / 42 smoke), deploy produksi (nginx/PM2/Docker/cPanel),
  struktur repo, roadmap, kontak Telegram, dan lisensi.
- Panduan lengkap gateway legacy tetap tersedia via folder `reference/`
  (dokumentasi lama tidak lagi menempati README utama).

### 2026-08-26 — `.gitignore` security-hardened

- *Changed* — `.gitignore` ditulis ulang berbasis inventaris file sensitif nyata
  di repo: env/secret di semua kedalaman (`.env`, `.env.*`, `.npmrc`/`.yarnrc*`
  yang bisa memuat auth token), sesi & token GoBiz (JSON sesi, cache,
  `provider_session*`, file import-session), database SQLite + sidecar
  (`*.db`, `-wal`, `-shm`, seluruh `platform/data/`), kunci privat
  (`*.pem`, `*.key`, `id_rsa`, dll.), dump SQL (`backup*.sql`) tanpa memblokir
  migrasi `platform/src/db/schema.*.sql`, log/temp/build artefak, junk OS/editor,
  override compose, folder `trash/` & `secrets/`, serta state lokal AI tools.
- Validasi pola dilakukan di repo git sementara (replika struktur asli):
  20 path sensitif ter-ignore ✓, 14 file legit (migrasi, `.env.example`,
  lockfile, skills) tetap ter-track ✓.

### 2026-08-26 — Reorganisasi repo: legacy dipindah ke `reference/`

- *Changed* — Seluruh kode & config gateway lama dipindah dari repo root ke
  folder **`reference/`**: `server.js`, `sessionManager.js`, `login.js`, `src/`,
  `scripts/`, `package.json` (+lock), `node_modules`, `Dockerfile`,
  `docker-compose.yml`, `setup.sh`, `.env.example`, `.env`, dan file sesi JSON.
- Root kini hanya berisi yang aktif: `platform/`, `paymenter-plugin/`,
  `reference/`, `trash/`, `.opencode/`, `AGENTS.md`, `CHANGELOG.md`, `README.md`,
  `LICENSE`, `.gitignore`, `opencode.json`.
- Perintah legacy (`npm start`, `npm run smoke`, `node login.js`, dll.) kini
  dijalankan dari dalam `reference/`. Fungsionalitas tidak berubah — hanya lokasi.
- File historis dipindah ke `trash/`: `old-script/`, `task.md`,
  `PROJECT_RESEARCH_REPORT.md`.

### 2026-08-24 — Keamanan halaman login admin

- *Fixed* — Form login kini selalu submit **POST**: atribut `method="post"`
  + fallback native ke `/api/admin/login` (urlencoded → redirect 303). Sebelumnya,
  bila JS gagal hydrate (mis. akses via IP LAN), browser memakai GET sehingga
  password bocor ke URL.
- *Added* — Blokir IP persisten (tabel `ip_blocks`, migrasi 004):
  - Otomatis: ≥3 kegagalan login berturut-turut dari satu IP (sejak sukses
    terakhir) → blokir **permanen**.
  - Manual: Admin > **Keamanan** (halaman baru) — blokir permanen/berdurasi,
    daftar blokir, buka blokir.
  - Pemberlakuan di halaman login & API login: IP diblokir melihat pesan
    "Akses Diblokir", tidak bisa mencoba login sama sekali.
- *Kept* — Rate limit per-IP (10 req/5 menit) dan kunci akun setelah kegagalan
  berulang tetap berlaku di atas mekanisme baru.

### 2026-08-24 — Multi-aplikasi (multi-platform) & secret per toko

**Platform**

- *Added* — Admin > **Aplikasi**: daftar aplikasi integrasi (satu per platform toko).
  Setiap aplikasi punya:
  - `X-BP-Key` (ID `APP-xxxx`) + **secret sendiri** (auto-generate atau manual, min 32 char);
    secret hanya tampil utuh saat dibuat/dirotasi.
  - Default **callback URL** dan default **redirect URL** — dipakai bila request pembayaran
    tidak menyertakan keduanya.
- *Added* — Autentikasi v1: header opsional `X-BP-Key: <APP-xxxx>`; signature diverifikasi
  dengan secret aplikasi tersebut. Callback ke transaksi milik aplikasi dikirim dengan secret
  aplikasi yang sama. Tanpa `X-BP-Key` tetap fallback ke secret global lama (kompatibilitas).
- *Changed* — Secret global dari `.env`/settings kini hanya fallback; cara resmi adalah
  mendaftarkan aplikasi. Migrasi DB: `schema.003.sql` (kolom `secret`, `callback_url`,
  `redirect_url` di `api_credentials`).
- *Changed* — DB browser transactions menampilkan kolom `integration_id` dan `redirect_url`.

**Plugin Paymenter (BandrewPay v1.1.0)**

- *Added* — Config **Redirect Link Setelah Bayar** (opsional; default tetap halaman invoice).
- *Added* — Config **ID Aplikasi (X-BP-Key)** untuk multi-aplikasi; header ikut dikirim saat
  create payment.
- *Changed* — Deskripsi field secret merujuk ke secret per-aplikasi.

### 2026-08-24 — Sesi GoPay penuh dari dashboard

- *Added* — Login OTP GoFood Merchant dari Admin > Sesi GoPay (port `login.js`; rate-limit
  3 permintaan OTP/15 menit). Sesi tersimpan di SQLite (`provider_session`), bukan file.
- *Added* — Auto-refresh token tiap 6 jam, restart-safe (anchor `updated_at`, dicek tiap
  15 menit + segera saat boot). Gagal refresh ditampilkan di dashboard untuk login manual.
- *Added* — Tombol **Refresh Token Sekarang** (refresh via refresh-token grant, tanpa OTP).

### 2026-08-24 — Pengaturan penuh dari dashboard

- *Changed* — Semua konfigurasi runtime dapat diubah dari Admin > Pengaturan; urutan
  prioritas **settings DB > env > default**. Interval monitor dibaca ulang tiap siklus
  (perubahan berlaku tanpa restart).
- *Added* — Ganti password admin dari dashboard (`POST /api/admin/password`).
- *Note* — `DATABASE_PATH` & `GOPAY_SESSION_FILE` tetap env-only.
