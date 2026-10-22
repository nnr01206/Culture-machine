// End-to-end check of LINE Login against a fake LINE server. Starts its own app on port 3101 and a fake
// LINE on 3102, so nothing real is contacted. Needs the docker compose DB.
// Usage: node scripts/e2e-line.mjs
// Wipes user/session data in the local DB first. Never point this at production.
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
if (!/127\.0\.0\.1|localhost/.test(process.env.DB_HOST || '')) throw new Error('refusing to run against a non-local DB');

const APP = 'http://127.0.0.1:3101';
const LINE_PORT = 3102;
const CHANNEL_ID = '1234567890';

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- Fake LINE: issues codes for whoever the test says is logging in, checks PKCE and the nonce.
const grants = new Map(); // code → { challenge, nonce, redirectUri, sub, name, email }
const fakeLine = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const form = new URLSearchParams(body);
    const json = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/oauth2/v2.1/token') {
      const g = grants.get(form.get('code'));
      const pkceOk = g && crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === g.challenge;
      if (!g || !pkceOk || form.get('client_secret') !== 'secret' || form.get('redirect_uri') !== g.redirectUri) {
        return json(400, { error: 'invalid_grant' });
      }
      grants.delete(form.get('code'));
      return json(200, { access_token: 'x', id_token: Buffer.from(JSON.stringify(g)).toString('base64url') });
    }
    if (req.url === '/oauth2/v2.1/verify') {
      const g = JSON.parse(Buffer.from(form.get('id_token'), 'base64url').toString());
      if (form.get('nonce') !== g.nonce) return json(400, { error: 'invalid_request', error_description: 'Invalid nonce.' });
      return json(200, { iss: 'https://access.line.me', aud: CHANNEL_ID, sub: g.sub, name: g.name, ...(g.email && { email: g.email }) });
    }
    json(404, {});
  });
});
await new Promise((r) => fakeLine.listen(LINE_PORT, '127.0.0.1', r));

const app = spawn(process.execPath, ['app.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env, PORT: '3101', NODE_ENV: 'test', MAIL_DEV_LOG: '1',
    LINE_CHANNEL_ID: ` ${CHANNEL_ID} `, LINE_CHANNEL_SECRET: 'secret ', LINE_CALLBACK_URL: '', // stray spaces must not matter // ignore the dev .env's LINE settings
    LINE_AUTHORIZE_URL: `http://127.0.0.1:${LINE_PORT}/authorize`, LINE_API_BASE: `http://127.0.0.1:${LINE_PORT}`,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const cleanup = () => { app.kill(); fakeLine.close(); };
for (let i = 0; ; i++) {
  try { if ((await fetch(`${APP}/api/health`)).ok) break; } catch {}
  if (i > 50) { cleanup(); throw new Error('app did not start'); }
  await new Promise((r) => setTimeout(r, 200));
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, timezone: 'Z',
});
for (const t of ['draws', 'capsules', 'rounds', 'activities', 'sessions', 'login_codes', 'users']) await db.query(`DELETE FROM ${t}`);

const cookieOf = (res, name) => res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));
const api = (cookie) => async (path, method = 'GET', body) => {
  const res = await fetch(`${APP}/api${path}`, { method, headers: { cookie, ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};

// Starts a LINE login and plays LINE's part. Returns where the callback sends the browser.
async function lineLogin(who, { next = '/activity?id=abc', tamper } = {}) {
  const start = await fetch(`${APP}/api/auth/line/start?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  const flowCookie = cookieOf(start, 'cm_line');
  const auth = new URL(start.headers.get('location'));
  const q = auth.searchParams;
  const code = crypto.randomBytes(8).toString('hex');
  grants.set(code, { challenge: q.get('code_challenge'), nonce: q.get('nonce'), redirectUri: q.get('redirect_uri'), ...who });
  const params = new URLSearchParams({ code, state: q.get('state'), ...tamper?.query });
  const cb = await fetch(`${APP}/api/auth/line/callback?${params}`, { redirect: 'manual', headers: { cookie: tamper?.cookie ?? flowCookie } });
  return { auth, location: cb.headers.get('location'), session: cookieOf(cb, 'cm_session') };
}

const profile = { nickname: 'x', region: '台東市', line_id: 'abc', consent: true };

// --- Options and the redirect to LINE
check((await api('')('/auth/options')).data.line === true, 'login page is told LINE login is available');
{
  const { auth } = await lineLogin({ sub: 'U-probe', name: 'probe' });
  const q = auth.searchParams;
  check(q.get('client_id') === CHANNEL_ID && q.get('scope') === 'openid profile email' && q.get('code_challenge_method') === 'S256',
    'redirect to LINE asks for openid/profile/email with PKCE');
  check(q.get('redirect_uri') === `${APP}/api/auth/line/callback`, 'callback URL derived from the request host');
}

// --- A new LINE user who shares an email
const amy = await lineLogin({ sub: 'U-amy', name: 'Amy 林', email: 'Amy@Example.com' });
check(amy.location === '/activity?id=abc' && Boolean(amy.session), 'LINE login sets a session and returns to the page it started from');
const amyApi = api(amy.session);
let me = (await amyApi('/auth/me')).data.user;
check(me.via === 'line' && me.email === 'amy@example.com' && me.lineName === 'Amy 林' && me.profile === null, '/me: LINE user, email from LINE, name for the form, no profile yet');
check((await amyApi('/me/profile', 'PUT', profile)).status === 200, 'LINE user can save a profile');
const [[amyRow]] = await db.query('SELECT id, email, line_user_id FROM users WHERE line_user_id = ?', ['U-amy']);
check(amyRow?.email === 'amy@example.com', 'user row stores both the LINE user ID and the email');
const amyAgain = await lineLogin({ sub: 'U-amy', name: 'Amy 林', email: 'amy@example.com' });
check((await api(amyAgain.session)('/auth/me')).data.user.profile?.id === amyRow.id, 'second LINE login finds the same user');
const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM users');
check(Number(n) === 1, 'no duplicate user created');

// --- An email-login user later signs in with LINE: linked to the same account
await db.query('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)', ['bob@example.com', sha('bob@example.com:123456')]);
const verify = await fetch(`${APP}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.com', code: '123456' }) });
const bobEmail = api(cookieOf(verify, 'cm_session'));
await bobEmail('/me/profile', 'PUT', { ...profile, nickname: 'Bob' });
const bobId = (await bobEmail('/auth/me')).data.user.profile.id;
const bobLine = await lineLogin({ sub: 'U-bob', name: 'Bob', email: 'bob@example.com' });
check((await api(bobLine.session)('/auth/me')).data.user.profile?.id === bobId, 'LINE login with the same email links to the existing email account');
check((await bobEmail('/auth/me')).data.user.profile?.id === bobId, 'email login still reaches the same account afterwards');

// --- A different LINE account with an email that is already taken by another LINE account
const imposter = await lineLogin({ sub: 'U-other', name: 'Other', email: 'bob@example.com' });
me = (await api(imposter.session)('/auth/me')).data.user;
check(me.email === null && me.profile === null, 'email already linked to another LINE account is not reused');

// --- LINE user who doesn't share an email
const cat = await lineLogin({ sub: 'U-cat', name: 'Cat' });
const catApi = api(cat.session);
me = (await catApi('/auth/me')).data.user;
check(me.email === null && me.via === 'line', 'LINE login without email works');
check((await catApi('/me/profile', 'PUT', profile)).status === 200, 'profile without email can be saved');
check((await catApi('/me/profile', 'PUT', { ...profile, contact_email: 'not-an-email' })).status === 400, 'contact email with a bad format rejected');
check((await catApi('/me/profile', 'PUT', { nickname: 'x', region: '台東市', contact_email: 'Cat@Contact.test' })).status === 200, 'contact email alone counts as a contact method');
check((await catApi('/auth/me')).data.user.profile.contact_email === 'cat@contact.test' && (await catApi('/auth/me')).data.user.email === null,
  'contact email is stored separately from the (empty) login email');

// --- Participating end to end without an email: drop, get drawn (no mail to send), see the draw
const adminCode = sha('admin@test.com:123456');
await db.query('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)', ['admin@test.com', adminCode]);
const adminVerify = await fetch(`${APP}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.com', code: '123456' }) });
const admin = api(cookieOf(adminVerify, 'cm_session'));
const ev = await admin('/admin/rounds', 'POST', {
  name: 'LINE 測試場', starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(),
  point: { name: '測試點', organizer_name: '主辦', organizer_contact: 'LINE @org' },
});
const slug = (await admin(`/admin/rounds/${ev.data.id}`)).data.point_slug;
const capsule = { title: 't', category: 'skill', description: 'd', duration: '1h' };
check((await catApi(`/activities/${slug}/capsules`, 'POST', capsule)).status === 201, 'LINE user without email can drop a capsule');
await amyApi(`/activities/${slug}/capsules`, 'POST', capsule);
const draw = await amyApi(`/activities/${slug}/draw`, 'POST');
check(draw.status === 200 && draw.data.provider?.nickname === 'x' && draw.data.provider.email === 'cat@contact.test', 'drawer sees the provider\'s contact email');
const catMe = (await catApi(`/activities/${slug}/me`)).data;
check(catMe.myCapsules[0]?.drawnBy?.length === 1 && catMe.myCapsules[0].drawnBy[0].nickname === 'x', 'no-email provider sees the draw in their records');

// --- First-time LINE user who types the email of an existing email account: merge after proving it
const plantCode = (email) => db.query('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)', [email, sha(`${email}:654321`)]);
await plantCode('dan@example.com');
const danVerify = await fetch(`${APP}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dan@example.com', code: '654321' }) });
const danEmail = api(cookieOf(danVerify, 'cm_session'));
await danEmail('/me/profile', 'PUT', { ...profile, nickname: 'Dan 舊' });
const danId = (await danEmail('/auth/me')).data.user.profile.id;
await danEmail(`/activities/${slug}/capsules`, 'POST', capsule);
const [[{ n: usersBefore }]] = await db.query('SELECT COUNT(*) AS n FROM users');

const danLine = api((await lineLogin({ sub: 'U-dan', name: 'Dan' })).session); // LINE gives no email
const danForm = { ...profile, nickname: 'Dan 新', contact_email: 'Dan@Example.com' };
const offer = await danLine('/me/profile', 'PUT', danForm);
check(offer.status === 409 && offer.data.code === 'MERGE_AVAILABLE', 'new LINE user typing an existing account\'s email is offered a merge');
const [[{ n: usersAfterOffer }]] = await db.query('SELECT COUNT(*) AS n FROM users');
check(Number(usersAfterOffer) === Number(usersBefore), 'nothing is created while the merge is pending');
check((await danLine('/me/merge', 'POST', { ...danForm, email: 'dan@example.com', code: '000000' })).status === 400, 'merge with a wrong code rejected');
await plantCode('dan@example.com');
check((await danLine('/me/merge', 'POST', { ...danForm, email: 'dan@example.com', code: '654321' })).status === 200, 'merge with the emailed code succeeds');
me = (await danLine('/auth/me')).data.user;
check(me.profile?.id === danId && me.profile.nickname === 'Dan 新' && me.email === 'dan@example.com', 'LINE login now opens the old account, updated with the new form');
check((await danLine(`/activities/${slug}/me`)).data.myCapsules.length === 1, 'old capsules are kept after the merge');
check((await danEmail('/auth/me')).data.user.profile?.id === danId, 'email login still opens the same account');
const [[{ n: usersAfterMerge }]] = await db.query('SELECT COUNT(*) AS n FROM users');
check(Number(usersAfterMerge) === Number(usersBefore), 'no duplicate account after the merge');

const eve = api((await lineLogin({ sub: 'U-eve', name: 'Eve' })).session);
check((await eve('/me/profile', 'PUT', { ...profile, contact_email: 'dan@example.com' })).status === 200, 'an account already tied to a LINE login is not offered again');
check((await eve('/me/merge', 'POST', { ...profile, email: 'dan@example.com', code: '654321' })).status === 409, 'merge API refuses once the user has a profile');

await plantCode('fay@example.com');
const fayVerify = await fetch(`${APP}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fay@example.com', code: '654321' }) });
await api(cookieOf(fayVerify, 'cm_session'))('/me/profile', 'PUT', profile);
const fayLine = api((await lineLogin({ sub: 'U-fay', name: 'Fay' })).session);
check((await fayLine('/me/profile', 'PUT', { ...profile, contact_email: 'fay@example.com' })).status === 409, 'merge offered for another email account');
check((await fayLine('/me/profile', 'PUT', { ...profile, contact_email: 'fay@example.com', skip_merge: true })).status === 200, '"not me" creates a separate account');
const [[fayRows]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE email = 'fay@example.com' OR line_user_id = 'U-fay'");
check(Number(fayRows.n) === 2, 'the email account and the new LINE account stay separate');

// --- Failure paths
const cancelled = await lineLogin({ sub: 'U-x' }, { tamper: { query: { error: 'access_denied' } } });
check(cancelled.location?.startsWith('/login?error=line_cancel') && !cancelled.session, 'cancel on LINE → back to login with a message');
const forged = await lineLogin({ sub: 'U-x' }, { tamper: { query: { state: 'forged' } } });
check(forged.location?.startsWith('/login?error=line_expired') && !forged.session, 'wrong state → rejected');
const noCookie = await lineLogin({ sub: 'U-x' }, { tamper: { cookie: '' } });
check(noCookie.location === '/login?error=line_expired' && !noCookie.session, 'callback without the flow cookie → rejected');
{
  // A callback whose code was issued for another login (different nonce/PKCE) must fail.
  const a = await fetch(`${APP}/api/auth/line/start`, { redirect: 'manual' });
  const b = await fetch(`${APP}/api/auth/line/start`, { redirect: 'manual' });
  const qa = new URL(a.headers.get('location')).searchParams;
  const qb = new URL(b.headers.get('location')).searchParams;
  grants.set('swap', { challenge: qb.get('code_challenge'), nonce: qb.get('nonce'), redirectUri: qb.get('redirect_uri'), sub: 'U-x' });
  const cb = await fetch(`${APP}/api/auth/line/callback?code=swap&state=${qa.get('state')}`, { redirect: 'manual', headers: { cookie: cookieOf(a, 'cm_line') } });
  check(cb.headers.get('location') === '/login?error=line_failed&next=%2F' && !cookieOf(cb, 'cm_session'), 'code from another login (PKCE/nonce mismatch) → rejected');
}
const evil = await lineLogin({ sub: 'U-amy', email: 'amy@example.com' }, { next: '//evil.example.com' });
check(evil.location === '/', 'next pointing off-site is replaced with /');

// --- Admins stay on email
const lineAdmin = await lineLogin({ sub: 'U-admin', name: 'Admin', email: 'admin@test.com' });
me = (await api(lineAdmin.session)('/auth/me')).data.user;
check(me.isAdmin === false && me.email === null, 'LINE login with an admin email gets no admin rights and no admin email');
check((await api(lineAdmin.session)('/admin/rounds')).status === 401, 'LINE session cannot open the admin API');

await db.end();
cleanup();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
