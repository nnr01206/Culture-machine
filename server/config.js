import { fileURLToPath } from 'node:url';

// Reads .env from the app root (not the cwd, which Passenger doesn't guarantee).
// Variables already set (e.g. in the cPanel Node.js App screen) are not overwritten.
try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch {}

export const env = process.env;
export const isProd = env.NODE_ENV === 'production';

export const adminEmails = new Set(
  (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

// Decision 23
export const AUTH = {
  codeTtlMs: 10 * 60 * 1000,
  resendCooldownMs: 60 * 1000,
  userSessionMs: 30 * 24 * 60 * 60 * 1000,
  adminSessionMs: 24 * 60 * 60 * 1000,
  cookieName: 'cm_session',
};

export const CATEGORIES = ['skill', 'time', 'space', 'knowledge', 'object', 'companion', 'experience', 'connection', 'creativity'];
export const DURATIONS = ['30m', '1h', '2h', '3h', 'half_day', 'none'];
