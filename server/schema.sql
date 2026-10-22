-- culture.machine schema. Applied on startup; every statement must be idempotent.

-- A user signs in with a verified email (code), with LINE, or both (linked by LINE's email).
-- email is NULL for LINE users who didn't share one; they just get no notification mail.
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NULL UNIQUE,
  line_user_id VARCHAR(64) NULL UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  region VARCHAR(50) NOT NULL,
  bio VARCHAR(200) NULL,
  line_id VARCHAR(100) NULL,
  instagram VARCHAR(100) NULL,
  phone VARCHAR(30) NULL,
  contact_email VARCHAR(255) NULL COMMENT 'shown after a draw; not verified, never used to sign in',
  show_email BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'superseded by contact_email (decision 32)',
  consent_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_codes_email (email, created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Admins have sessions but no users row (decision 12), so sessions key on email, or on the LINE
-- user ID for LINE logins (never admin). line_name pre-fills the nickname on the profile form.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  email VARCHAR(255) NULL,
  line_user_id VARCHAR(64) NULL,
  line_name VARCHAR(100) NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_email (email)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UI name: QR 點位. A long-lived entry point with a fixed, reusable QR code (e.g. the bookstore).
CREATE TABLE IF NOT EXISTS activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  organizer_name VARCHAR(100) NOT NULL,
  organizer_contact VARCHAR(255) NOT NULL,
  per_user_limit INT NULL COMMENT 'capsules per user per round; NULL = unlimited',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- UI name: 活動. One event at a QR point, live while starts_at <= now < ends_at.
-- Events at the same QR point never overlap.
CREATE TABLE IF NOT EXISTS rounds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rounds_time (activity_id, starts_at, ends_at),
  FOREIGN KEY (activity_id) REFERENCES activities(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- user_id NULL = organizer capsule (decision 19). Special capsules are fallback-only (decision 8).
CREATE TABLE IF NOT EXISTS capsules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  round_id INT NOT NULL,
  user_id INT NULL,
  category ENUM('skill','time','space','knowledge','object','companion','experience','connection','creativity') NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  duration ENUM('30m','1h','2h','3h','half_day','none') NOT NULL,
  conditions TEXT NULL,
  is_special BOOLEAN NOT NULL DEFAULT FALSE,
  max_draws INT NOT NULL DEFAULT 1,
  draw_count INT NOT NULL DEFAULT 0,
  status ENUM('open','drawn','removed') NOT NULL DEFAULT 'open',
  expires_at DATETIME NULL COMMENT 'reserved, not enforced in MVP (decision 7)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_capsules_pool (round_id, status, is_special),
  INDEX idx_capsules_user (user_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- status beyond 'drawn' is reserved; who reports it is undecided (decision 5).
CREATE TABLE IF NOT EXISTS draws (
  id INT AUTO_INCREMENT PRIMARY KEY,
  round_id INT NOT NULL,
  capsule_id INT NOT NULL,
  drawer_id INT NOT NULL,
  status ENUM('drawn','contacted','completed','failed') NOT NULL DEFAULT 'drawn',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_draws_round (round_id),
  INDEX idx_draws_drawer (drawer_id, round_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id),
  FOREIGN KEY (capsule_id) REFERENCES capsules(id),
  FOREIGN KEY (drawer_id) REFERENCES users(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- One row per minute per Node process: traffic, latency and resource use (decision 34). Kept 14 days.
CREATE TABLE IF NOT EXISTS metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  minute DATETIME NOT NULL,
  pid INT NOT NULL,
  requests INT NOT NULL,
  status_4xx INT NOT NULL,
  status_5xx INT NOT NULL,
  p50_ms INT NULL,
  p95_ms INT NULL,
  max_ms INT NULL,
  max_in_flight INT NOT NULL COMMENT 'most requests being handled at the same moment',
  rss_mb DECIMAL(8,1) NOT NULL,
  heap_mb DECIMAL(8,1) NOT NULL,
  cpu_pct DECIMAL(6,1) NOT NULL COMMENT '100 = one full CPU core',
  loop_p99_ms DECIMAL(8,1) NULL COMMENT 'event loop delay; high means Node itself is overloaded',
  db_max_busy INT NOT NULL COMMENT 'most DB connections in use at once (pool size in db.js)',
  db_waits INT NOT NULL COMMENT 'queries that had to wait for a free DB connection',
  INDEX idx_metrics_minute (minute)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Unexpected failures (5xx, LINE login, mail, crashes) so they can be read from the admin page. Kept 90 days.
-- Paths are stored without the query string, so no OAuth codes or other secrets end up here.
CREATE TABLE IF NOT EXISTS error_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source VARCHAR(30) NOT NULL COMMENT 'request | line_login | mail | process',
  method VARCHAR(10) NULL,
  path VARCHAR(255) NULL,
  status INT NULL,
  message VARCHAR(1000) NOT NULL,
  stack TEXT NULL,
  pid INT NOT NULL,
  INDEX idx_error_logs_created (created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
