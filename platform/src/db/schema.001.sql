-- BandrewPay schema (SQLite).
-- Diaplikasikan berurutan oleh src/db/migrator.ts; jangan edit migration yang sudah terlanjur
-- dijalankan — tambahkan file migration baru.

-- 001_initial.sql ------------------------------------------------------------

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  failed_attempts    INTEGER NOT NULL DEFAULT 0,
  locked_until       INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  last_login_at      INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token           TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  idle_expires_at      INTEGER NOT NULL,
  absolute_expires_at  INTEGER NOT NULL,
  last_seen_at         INTEGER NOT NULL,
  ip                   TEXT,
  user_agent           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT,
  ip           TEXT,
  successful   INTEGER NOT NULL CHECK (successful IN (0, 1)),
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(username, attempted_at);

CREATE TABLE IF NOT EXISTS api_credentials (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL,
  integration_id      TEXT REFERENCES api_credentials(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL DEFAULT 'gopay',
  amount              INTEGER NOT NULL CHECK (amount > 0),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED')),
  qris_payload        TEXT,
  customer_name       TEXT,
  customer_email      TEXT,
  callback_url        TEXT,
  redirect_url        TEXT,
  expires_at          INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  paid_at             INTEGER,
  expired_at          INTEGER,
  paid_amount         INTEGER,
  matched_provider_tx TEXT,
  last_checked_at     INTEGER
);
-- Idempotensi pembuatan: satu order hanya boleh punya SATU transaksi aktif.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_per_order
  ON transactions(order_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_transactions_status_expiry ON transactions(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

-- Proteksi double-payment yang bertahan restart: satu tx upstream hanya boleh diklaim sekali.
CREATE TABLE IF NOT EXISTS claims (
  provider_tx_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  claimed_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_transaction ON claims(transaction_id);

CREATE TABLE IF NOT EXISTS monitor_viewers (
  viewer_id      TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  expires_at     INTEGER NOT NULL,
  started_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_viewers_trx ON monitor_viewers(transaction_id, expires_at);

-- Riwayat transaksi append-only (tidak pernah di-edit/di-hapus oleh CRUD biasa).
CREATE TABLE IF NOT EXISTS payment_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,
  payload_json   TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_events_trx ON payment_events(transaction_id, id);

CREATE TABLE IF NOT EXISTS callback_deliveries (
  id                  TEXT PRIMARY KEY,
  transaction_id      TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  url                 TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  payload_json        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'GIVING_UP')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 5,
  next_retry_at       INTEGER NOT NULL,
  last_response_code  INTEGER,
  last_error          TEXT,
  created_at          INTEGER NOT NULL,
  delivered_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_callbacks_due ON callback_deliveries(status, next_retry_at);

CREATE TABLE IF NOT EXISTS callback_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id  TEXT NOT NULL REFERENCES callback_deliveries(id) ON DELETE CASCADE,
  attempt_no   INTEGER NOT NULL,
  success      INTEGER NOT NULL CHECK (success IN (0, 1)),
  response_code INTEGER,
  error        TEXT,
  attempted_at INTEGER NOT NULL
);

-- Catatan webhook masuk (dari provider/integrator) untuk audit & dedup.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  processed    INTEGER NOT NULL DEFAULT 0 CHECK (processed IN (0, 1)),
  received_at  INTEGER NOT NULL
);

-- Replay protection untuk request integrasi (nonce sudah dipakai dibuang).
CREATE TABLE IF NOT EXISTS nonces (
  nonce_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nonces_expiry ON nonces(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details_json TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sesi provider GoBiz (bearer/refresh token) tersimpan di DB (file DB chmod 600),
-- menggantikan plaintext JSON legacy. Diimpor via `npm run import-session`.
CREATE TABLE IF NOT EXISTS provider_session (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
