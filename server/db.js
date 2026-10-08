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
