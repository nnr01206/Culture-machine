import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { env } from './config.js';

export const pool = mysql.createPool({
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 5,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: false,
});

// Store and compare everything in UTC regardless of the host's MySQL time zone,
// so DEFAULT CURRENT_TIMESTAMP, UTC_TIMESTAMP() and JS Dates all agree.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) await pool.query(stmt);
  await upgrade();
}

async function columnExists(table, column) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  return Number(row.n) > 0;
}

// schema.sql only creates missing tables; this brings tables created by older versions up to date.
// Every step checks before it changes anything, so it is safe to run on every startup.
async function upgrade() {
  // v2: rounds open/close by time instead of a manual is_open flag.
  if (await columnExists('rounds', 'is_open')) {
    // Rounds still open under the old model get a 90-day window; closed ones already have ends_at.
    await pool.query('UPDATE rounds SET ends_at = UTC_TIMESTAMP() + INTERVAL 90 DAY WHERE ends_at IS NULL AND is_open = TRUE');
    await pool.query('UPDATE rounds SET ends_at = starts_at + INTERVAL 1 SECOND WHERE ends_at IS NULL');
    await pool.query('ALTER TABLE rounds MODIFY ends_at DATETIME NOT NULL, DROP COLUMN is_open');
  }
}

// Runs fn inside a transaction on a dedicated connection.
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
