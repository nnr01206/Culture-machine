import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from './db.js';
import { sendMail } from './mail.js';
import { AUTH, adminEmails, isProd, env } from './config.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd && env.COOKIE_SECURE !== '0',
    maxAge,
    path: '/',
  };
}

// Attaches req.session = { email, isAdmin } when the cookie is valid. Slides user sessions forward.
export async function loadSession(req, res, next) {
  const token = readCookie(req, AUTH.cookieName);
  if (!token) return next();
  const hash = sha256(token);
  const [[row]] = await pool.query(
    'SELECT email, is_admin, expires_at FROM sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()',
    [hash],
  );
  if (!row) return next();
  // Admin list lives in env: removing someone from ADMIN_EMAILS revokes their admin session.
  const isAdmin = Boolean(row.is_admin) && adminEmails.has(row.email);
  if (row.is_admin && !isAdmin) return next();
  req.session = { email: row.email, isAdmin };

  if (!isAdmin) {
    const remaining = new Date(row.expires_at).getTime() - Date.now();
    // Only write when at least a day has been used, to avoid a DB write per request.
    if (remaining < AUTH.userSessionMs - 24 * 60 * 60 * 1000) {
      await pool.query('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', [
        new Date(Date.now() + AUTH.userSessionMs),
        hash,
      ]);
      res.cookie(AUTH.cookieName, token, cookieOptions(AUTH.userSessionMs));
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(401).json({ error: '需要管理者登入' });
  next();
}

export const authRouter = Router();

authRouter.post('/request-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email 格式不正確' });

  const [[last]] = await pool.query(
    'SELECT created_at FROM login_codes WHERE email = ? ORDER BY id DESC LIMIT 1',
    [email],
  );
  if (last) {
    const wait = AUTH.resendCooldownMs - (Date.now() - new Date(last.created_at).getTime());
    if (wait > 0) {
      return res.status(429).json({ error: `請等 ${Math.ceil(wait / 1000)} 秒後再重寄`, retryAfter: Math.ceil(wait / 1000) });
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await pool.query('INSERT INTO login_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    email,
    sha256(`${email}:${code}`),
    new Date(Date.now() + AUTH.codeTtlMs),
    new Date(),
  ]);
  await sendMail({
    to: email,
    subject: `文化扭蛋機登入驗證碼：${code}`,
    text: `你的登入驗證碼是 ${code}\n\n10 分鐘內有效。如果不是你本人操作，請忽略這封信。`,
  });
  res.json({ ok: true });
});

authRouter.post('/verify', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();
  const [[row]] = await pool.query(
    `SELECT id FROM login_codes
     WHERE email = ? AND code_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
     ORDER BY id DESC LIMIT 1`,
    [email, sha256(`${email}:${code}`)],
  );
  if (!row) return res.status(400).json({ error: '驗證碼錯誤或已過期' });
  await pool.query('UPDATE login_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);

  const isAdmin = adminEmails.has(email);
  const ttl = isAdmin ? AUTH.adminSessionMs : AUTH.userSessionMs;
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions (token_hash, email, is_admin, expires_at) VALUES (?, ?, ?, ?)', [
    sha256(token),
    email,
    isAdmin,
    new Date(Date.now() + ttl),
  ]);
  res.cookie(AUTH.cookieName, token, cookieOptions(ttl));
  res.json({ ok: true, email, isAdmin });
});

authRouter.get('/me', async (req, res) => {
  if (!req.session) return res.json({ user: null });
  const { email, isAdmin } = req.session;
  let profile = null;
  if (!isAdmin) {
    const [[u]] = await pool.query(
      'SELECT id, nickname, region, bio, line_id, instagram, phone, show_email FROM users WHERE email = ?',
      [email],
    );
    profile = u || null;
  }
  res.json({ user: { email, isAdmin, profile } });
});

authRouter.post('/logout', async (req, res) => {
  const token = readCookie(req, AUTH.cookieName);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(AUTH.cookieName, { path: '/' });
  res.json({ ok: true });
});
