// LINE Login (OpenID Connect, LINE Login v2.1) for participants. Admins keep signing in by email.
// Flow: /start sends the browser to LINE → LINE sends it back to /callback with a code → we swap the
// code for an ID token, have LINE verify it, find or create the user and start a session.
import crypto from 'node:crypto';
import { Router } from 'express';
import { pool } from './db.js';
import { adminEmails, env, isProd } from './config.js';
import { cookieOptions, startSession } from './auth.js';

const FLOW_COOKIE = 'cm_line';
const FLOW_PATH = '/api/auth/line';
const FLOW_TTL_MS = 10 * 60 * 1000;

// The two URL overrides exist only so the e2e test can point at a fake LINE; ignored in production.
const authorizeUrl = () => (!isProd && env.LINE_AUTHORIZE_URL) || 'https://access.line.me/oauth2/v2.1/authorize';
const apiBase = () => (!isProd && env.LINE_API_BASE) || 'https://api.line.me';

// Must match a Callback URL registered in the LINE Developers console exactly.
const callbackUrl = (req) => env.LINE_CALLBACK_URL || `${req.protocol}://${req.get('host')}${FLOW_PATH}/callback`;

const random = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

function readFlow(req) {
  const raw = (req.headers.cookie || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${FLOW_COOKIE}=`));
  try {
    return raw ? JSON.parse(Buffer.from(raw.slice(FLOW_COOKIE.length + 1), 'base64url').toString()) : null;
  } catch {
    return null;
  }
}

async function postForm(path, params) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE ${path} ${res.status}: ${data.error_description || data.error || 'error'}`);
  return data;
}

// Finds the user for this LINE account. A first LINE login whose email matches an email-login account
// is linked to it, so earlier capsules and draws stay with the same person.
async function resolveIdentity(lineUserId, lineEmail) {
  const [[byLine]] = await pool.query('SELECT email FROM users WHERE line_user_id = ?', [lineUserId]);
  if (byLine) return byLine.email;
  if (!lineEmail || adminEmails.has(lineEmail)) return null; // admin addresses never become participants
  const [[byEmail]] = await pool.query('SELECT id, line_user_id FROM users WHERE email = ?', [lineEmail]);
  if (!byEmail) return lineEmail;
  if (byEmail.line_user_id) return null; // that email already belongs to another LINE account
  await pool.query('UPDATE users SET line_user_id = ? WHERE id = ? AND line_user_id IS NULL', [lineUserId, byEmail.id]);
  return lineEmail;
}

export const lineRouter = Router();

lineRouter.get('/start', (req, res) => {
  if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET) return res.redirect('/login?error=line_off');
  const flow = { state: random(), nonce: random(), verifier: random(48), next: safeNext(req.query.next) };
  res.cookie(FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString('base64url'), { ...cookieOptions(FLOW_TTL_MS), path: FLOW_PATH });
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINE_CHANNEL_ID,
    redirect_uri: callbackUrl(req),
    state: flow.state,
    scope: 'openid profile email',
    nonce: flow.nonce,
    code_challenge: crypto.createHash('sha256').update(flow.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  res.redirect(`${authorizeUrl()}?${query}`);
});

lineRouter.get('/callback', async (req, res) => {
  const flow = readFlow(req);
  res.clearCookie(FLOW_COOKIE, { path: FLOW_PATH });
  const fail = (reason) => res.redirect(`/login?error=${reason}${flow ? `&next=${encodeURIComponent(flow.next)}` : ''}`);

  // state ties this callback to the browser that started the login (CSRF protection).
  if (!flow || !req.query.state || req.query.state !== flow.state) return fail('line_expired');
  if (req.query.error || !req.query.code) return fail('line_cancel'); // e.g. the user tapped Cancel

  try {
    const token = await postForm('/oauth2/v2.1/token', {
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: callbackUrl(req),
      client_id: env.LINE_CHANNEL_ID,
      client_secret: env.LINE_CHANNEL_SECRET,
      code_verifier: flow.verifier,
    });
    // LINE checks the signature, expiry, audience and our nonce.
    const id = await postForm('/oauth2/v2.1/verify', { id_token: token.id_token, client_id: env.LINE_CHANNEL_ID, nonce: flow.nonce });
    if (!id.sub || id.aud !== env.LINE_CHANNEL_ID) throw new Error('LINE ID token has no subject or a wrong audience');

    const email = await resolveIdentity(id.sub, id.email ? String(id.email).trim().toLowerCase() : null);
    await startSession(res, { email, lineUserId: id.sub, lineName: id.name ? String(id.name).slice(0, 100) : null });
    res.redirect(flow.next);
  } catch (err) {
    console.error('LINE login failed:', err.message);
    fail('line_failed');
  }
});
