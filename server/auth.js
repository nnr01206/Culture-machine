import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from './db.js';
import { sendMail } from './mail.js';
import { AUTH, adminEmails, isProd, env } from './config.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd && env.COOKIE_SECURE !== '0',
    maxAge,
    path: '/',
  };
}

// Attaches req.session = { email, lineUserId, lineName, isAdmin } when the cookie is valid.
// email is null for a LINE login without a shared email. Slides user sessions forward.
export async function loadSession(req, res, next) {
  const token = readCookie(req, AUTH.cookieName);
  if (!token) return next();
  const hash = sha256(token);
  const [[row]] = await pool.query(
    'SELECT email, line_user_id, line_name, is_admin, expires_at FROM sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()',
    [hash],
  );
  if (!row) return next();
  // Admin list lives in env: removing someone from ADMIN_EMAILS revokes their admin session.
  const isAdmin = Boolean(row.is_admin) && adminEmails.has(row.email);
  if (row.is_admin && !isAdmin) return next();
  req.session = { email: row.email, lineUserId: row.line_user_id, lineName: row.line_name, isAdmin };

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

// Creates a session and sets the cookie. LINE logins are never admin (admins sign in by email).
export async function startSession(res, { email = null, lineUserId = null, lineName = null, isAdmin = false }) {
  const ttl = isAdmin ? AUTH.adminSessionMs : AUTH.userSessionMs;
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token_hash, email, line_user_id, line_name, is_admin, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sha256(token), email, lineUserId, lineName, isAdmin, new Date(Date.now() + ttl)],
  );
  res.cookie(AUTH.cookieName, token, cookieOptions(ttl));
}

// The participant behind a session: by LINE user ID for LINE logins, otherwise by email.
export async function findUser(session, conn = pool) {
  const [[u]] = session.lineUserId
    ? await conn.query('SELECT * FROM users WHERE line_user_id = ?', [session.lineUserId])
    : await conn.query('SELECT * FROM users WHERE email = ?', [session.email]);
  return u || null;
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

// Checks an emailed code and uses it up. Also proves email ownership when merging accounts.
export async function consumeCode(email, code) {
  const [[row]] = await pool.query(
    `SELECT id FROM login_codes
     WHERE email = ? AND code_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
     ORDER BY id DESC LIMIT 1`,
    [email, sha256(`${email}:${String(code || '').trim()}`)],
  );
  if (!row) return false;
  await pool.query('UPDATE login_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
  return true;
}

authRouter.post('/verify', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!(await consumeCode(email, req.body?.code))) return res.status(400).json({ error: '驗證碼錯誤或已過期' });

  const isAdmin = adminEmails.has(email);
  await startSession(res, { email, isAdmin });
  res.json({ ok: true, email, isAdmin });
});

// Which sign-in methods the login page should offer.
authRouter.get('/options', (req, res) => {
  res.json({ line: Boolean(env.LINE_CHANNEL_ID?.trim() && env.LINE_CHANNEL_SECRET?.trim()) });
});

authRouter.get('/me', async (req, res) => {
  if (!req.session) return res.json({ user: null });
  const { email, lineUserId, lineName, isAdmin } = req.session;
  let profile = null;
  if (!isAdmin) {
    const u = await findUser(req.session);
    profile = u && {
      id: u.id, nickname: u.nickname, region: u.region, bio: u.bio,
      line_id: u.line_id, instagram: u.instagram, phone: u.phone, contact_email: u.contact_email,
    };
  }
  res.json({ user: { email, isAdmin, via: lineUserId ? 'line' : 'email', lineName, profile } });
});

authRouter.post('/logout', async (req, res) => {
  const token = readCookie(req, AUTH.cookieName);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(AUTH.cookieName, { path: '/' });
  res.json({ ok: true });
});
