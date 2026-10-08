-- culture.machine schema. Applied on startup; every statement must be idempotent.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  region VARCHAR(50) NOT NULL,
  bio VARCHAR(200) NULL,
  line_id VARCHAR(100) NULL,
  instagram VARCHAR(100) NULL,
  phone VARCHAR(30) NULL,
  show_email BOOLEAN NOT NULL DEFAULT FALSE,
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

-- Admins have sessions but no users row (decision 12), so sessions key on email.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_email (email)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- An activity is a long-lived entry point with a fixed QR code (decision 13).
CREATE TABLE IF NOT EXISTS activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  organizer_name VARCHAR(100) NOT NULL,
  organizer_contact VARCHAR(255) NOT NULL,
  per_user_limit INT NULL COMMENT 'capsules per user per round; NULL = unlimited',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rounds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rounds_activity (activity_id, is_open),
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
