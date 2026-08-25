# AGENTS.md — BandrewPay

Self-hosted QRIS payment gateway (GoBiz/GoPay Food Merchant) built on **Next.js 16 + React 19 + SQLite** (better-sqlite3), with a Paymenter extension. Primary codebase = `platform/`.

## Repo layout

- `platform/` — the product: API v1 (HMAC), buyer pay page, admin dashboard, monitor coordinator, callback outbox. Docs: `platform/docs/ARCHITECTURE.md`.
- `paymenter-plugin/BandrewPay/` — official Paymenter extension (v1.1.x). Has its own README.
- `reference/` — legacy Express gateway kept as porting reference/fallback. Do not reorganize further.
- `trash/`, all `*.db*`, `.env*`, session JSONs — local-only, gitignored. Never commit.

## Commands (run inside `platform/`)

```bash
npm run dev            # dev server :4100
npm test               # unit tests (node --test tests/unit/*.test.ts)
npm run smoke          # e2e: runs `next build` ITSELF, boots prod server :4199 + webhook receiver :4210
npm run db:migrate     # applies pending src/db/schema.*.sql (tracked in schema_migrations)
npm run seed           # first admin user (only when users table empty)
npm run import-session -- <legacy-session.json>   # one-time bootstrap of GoBiz session
npm run audit:deps     # npm audit --omit=dev + outdated
```

- **No `typecheck` script exists** — use `npx tsc --noEmit`.
- Run a single test file: `node --experimental-strip-types --test tests/unit/<name>.test.ts`
- Verification order before finishing work: `tsc --noEmit` → relevant unit test(s) → full `npm run smoke`. All three must pass.
- Smoke hygiene: preflights ports 4199/4210, spawns server detached (kills whole process group), deletes ONLY `data/smoke.db*` — never touch `data/gateway.db`.

## Toolchain quirks

- `"type":"module"` + `allowImportingTsExtensions`: relative imports need explicit `.ts/.tsx`. The `@/` alias works inside Next code; unit tests import via relative paths instead.
- Scripts/tests execute TS directly via `node --experimental-strip-types` (needs modern Node ≥22; dev box runs 26). Env loaded via `--env-file-if-exists=.env`.
- better-sqlite3 `.get()` returns `{}` for aggregates — COUNT needs `as unknown as {c:number}` casts.
- Pure SQL + prepared statements everywhere, no ORM. New migration = add `src/db/schema.<next>.sql`, then `db:migrate`.
- Unit tests are hermetic: each suite sets `process.env.DATABASE_PATH` (`:memory:` or mkdtemp) BEFORE importing modules that call `getDb()` — preserve that ordering when adding tests.

## Money & auth invariants (do not violate)

- `amount` (reported to integrators/callbacks) vs `payable_amount` (= amount + unique code 1..100): the QRIS charges and the verifier matches **payable_amount**, never `amount`.
- Status transitions are terminal and go through `transitionTransaction()` (compare-and-set + append-only event + audit, one DB transaction): `PENDING → PAID | EXPIRED | FAILED`, no way back. Persistent `claims` table prevents double-delivery across restarts.
- Response envelope is always `{success: boolean, ...}` — legacy integrators depend on it.
- Integration HMAC v2 headers: `X-BP-Signature = hex(HMAC_SHA256(secret, "${ts}.${nonce}.${sha256hex(rawBody)}"))`, ±5min skew, stored-nonce replay rejection. Optional `X-BP-Key: APP-xxxx` selects a per-app secret (Admin › Aplikasi); without it the global `INTEGRATION_SECRET` is legacy fallback only.
- Runtime config precedence: **settings DB > env > default** via `config-store.ts` `effective*` getters. The monitor uses recursive `setTimeout` and re-reads intervals every cycle, so dashboard changes apply without restart. `DATABASE_PATH`/`GOPAY_SESSION_FILE` stay env-only.
- Monitoring is lease-based: exactly ONE provider poller per active transaction regardless of viewer count; browsers never trigger provider calls. Never raise poll frequency (merchant ban risk).
- QRIS artifacts live in SQLite and render on-the-fly (`/api/pay/[id]/qr.png`) — never write QR files to disk.
- Provider GoBiz session lives ONLY in SQLite (`provider_session`); auto-refresh every 6h anchored to `updated_at`; OTP requests capped at 3/15min (anti-ban). Re-login via Admin › Sesi GoPay.
- Admin login form must always submit POST (native urlencoded fallback → 303 redirect, never GET — password-in-URL bug). IP blocking lives in `ip_blocks`: ≥3 consecutive failures → permanent block, managed at Admin › Keamanan.
- Buyer pay page (`/pay`): after PAID the client waits a visible 5-second countdown (`REDIRECT_DELAY_SECONDS` in `pay-view.ts`) before navigating to `redirect_url`; all its styles live in co-located `pay.css` ported from `Payment-ui/` (no external fonts/icons — CSP-safe).
- GoPay merchant IDs are canonicalized everywhere via `normalizeGoPayMerchantId` (settings/env accept digits or G-form; runtime always sends `Gxxxxxx` - a G-less value made GoBiz return 403 'unauthorized merchant access').
- Middleware CSP nonce header is `x-csp-nonce` — NEVER rename (collides with integration HMAC headers `X-BP-*`).

## Secrets

Never read/print/commit `.env*`, `platform/data/*`, `*SESI_JANGAN_DIHAPUS*`, or any key material. Existence/mtime checks only. Admin password hashing is scrypt; sessions are DB-backed HttpOnly cookies; mutations require CSRF double-submit token.

## Workflow rules

0. Any feature/behavior change → update root `CHANGELOG.md` AND the relevant READMEs (root, `platform/docs` if architectural, plugin README) in the same change.
1. Upstream GoBiz APIs are reverse-engineered: change parsers only with evidence from real responses. Amounts arrive x100 (`normalizeGojekAmount`); `expires_at` (+24h) is a hardcoded assumption, not server-provided. Upstream verification PAGES through analytics results (size 20, up to `UPSTREAM_MAX_PAGES`) - never revert to first-page-only matching.

## Legacy notes (`reference/`)

- Run legacy commands from inside `reference/` (`npm start`, `node scripts/check-env.js`, `node login.js` — interactive OTP only, never automate against a production phone number).
- cPanel Node-18 constraint applies to LEGACY deploys only; `platform/` requires Node ≥ 20.
- Do not reintroduce Express internal dispatches like `app._router.handle`.

## Skills available (load via `skill` tool)

`gopay-gateway-overview` (start here) · `gopay-api-integration` · `qris-emvco` · `backend-api-conventions` · `frontend-ui-checkout` · `gateway-debugging` · `gateway-security` · `gateway-operations` · `database-persistence` · `storefront-integration`
