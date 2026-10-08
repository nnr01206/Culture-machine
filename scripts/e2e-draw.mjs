// End-to-end check of the participant flow against a running server + local MySQL.
// Usage: node scripts/e2e-draw.mjs [baseUrl]   (needs the docker compose DB and MAIL_DEV_LOG=1 server)
// Wipes activity/round/capsule/draw/user data in the local DB first. Never point this at production.
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
const BASE = process.argv[2] || 'http://localhost:3000';
if (!/localhost|127\.0\.0\.1/.test(BASE) || !/127\.0\.0\.1|localhost/.test(process.env.DB_HOST || '')) {
  throw new Error('refusing to run against a non-local server or DB');
}
const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, timezone: 'Z',
});
await db.query("SET time_zone = '+00:00'");
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// Logs in by planting a known code (skips SMTP) and returns a fetch bound to that session.
async function login(email) {
  const code = '123456';
  await db.query('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)', [email, sha(`${email}:${code}`)]);
  const r = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, method = 'GET', body) => {
    const res = await fetch(`${BASE}/api${path}`, { method, headers: { cookie, ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

for (const t of ['draws', 'capsules', 'rounds', 'activities', 'sessions', 'login_codes', 'users']) await db.query(`DELETE FROM ${t}`);

const admin = await login('admin@test.com');
const { data: act } = await admin('/admin/activities', 'POST', { name: 'E2E', organizer_name: '主辦方', organizer_contact: 'LINE @org' });
const slug = act.slug;
const { data: round } = await admin(`/admin/activities/${act.id}/rounds`, 'POST', { name: '測試輪' });

const capsule = (title) => ({ title, category: 'skill', description: `${title} 的說明`, duration: '1h' });

// --- single-user rules
const a = await login('a@test.com');
check((await a(`/activities/${slug}/me`)).status === 409, 'no profile → /me is 409');
check((await a('/me/profile', 'PUT', { nickname: 'A', region: '台東市' })).status === 400, 'profile without any contact rejected');
check((await a('/me/profile', 'PUT', { nickname: 'A', region: '台東市', line_id: 'a-line' })).status === 400, 'new profile without consent rejected');
check((await a('/me/profile', 'PUT', { nickname: 'A', region: '台東市', line_id: 'a-line', consent: true })).status === 200, 'profile created');
check((await a(`/activities/${slug}/draw`, 'POST')).status === 409, 'draw with 0 credits rejected');
const dropA = await a(`/activities/${slug}/capsules`, 'POST', capsule('A 的蛋'));
check(dropA.status === 201 && dropA.data.credits === 1, 'drop gives 1 credit');
const emptyDraw = await a(`/activities/${slug}/draw`, 'POST');
check(emptyDraw.status === 409 && emptyDraw.data.code === 'EMPTY', 'only own capsule in pool → EMPTY');
check((await a(`/activities/${slug}/me`)).data.credits === 1, 'EMPTY keeps the credit');
check((await admin('/admin/activities', 'GET')).status === 200 && (await admin(`/activities/${slug}/draw`, 'POST')).status === 403, 'admin cannot draw');

// --- B draws A's capsule; contacts revealed both ways
const b = await login('b@test.com');
await b('/me/profile', 'PUT', { nickname: 'B', region: '池上', instagram: 'b_ig', consent: true });
await b(`/activities/${slug}/capsules`, 'POST', capsule('B 的蛋'));
const drawB = await b(`/activities/${slug}/draw`, 'POST');
check(drawB.status === 200 && drawB.data.capsule.title === 'A 的蛋' && drawB.data.provider.line_id === 'a-line', 'B draws A and sees A\'s LINE');
check(drawB.data.provider.email === null, 'provider email hidden when show_email is off');
const meA = (await a(`/activities/${slug}/me`)).data;
check(meA.myCapsules[0].drawnBy[0]?.instagram === 'b_ig', 'A sees B\'s contact on their capsule');

// --- A draws B's capsule; then nobody left → special fallback
const drawA = await a(`/activities/${slug}/draw`, 'POST');
check(drawA.data?.capsule?.title === 'B 的蛋', 'A draws B');
const c = await login('c@test.com');
await c('/me/profile', 'PUT', { nickname: 'C', region: '關山', line_id: 'c', consent: true });
await c(`/activities/${slug}/capsules`, 'POST', capsule('C 的蛋'));
check((await c(`/activities/${slug}/draw`, 'POST')).data?.code === 'EMPTY', 'C stuck with only own capsule, no special yet → EMPTY');
await admin(`/admin/rounds/${round.id}/capsules`, 'POST', { ...capsule('特別蛋'), is_special: true, max_draws: 2 });
const drawC = await c(`/activities/${slug}/draw`, 'POST');
check(drawC.data?.capsule?.is_special === true && drawC.data.provider.organizer === true, 'C falls back to the special capsule, sees organizer contact');

// --- per-user limit
await admin(`/admin/activities/${act.id}`, 'PATCH', { per_user_limit: 2 });
await c(`/activities/${slug}/capsules`, 'POST', capsule('C2'));
check((await c(`/activities/${slug}/capsules`, 'POST', capsule('C3'))).status === 409, 'per-user limit enforced');
await admin(`/admin/activities/${act.id}`, 'PATCH', { per_user_limit: null });

// --- concurrency: 30 users drop then all draw at once
const N = 30;
const users = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const u = await login(`p${i}@test.com`);
  await u('/me/profile', 'PUT', { nickname: `P${i}`, region: '台東', line_id: `p${i}`, consent: true });
  await u(`/activities/${slug}/capsules`, 'POST', capsule(`P${i} 的蛋`));
  return u;
}));
// Each user taps "draw" twice at the same time: only one may succeed.
const results = await Promise.all(users.flatMap((u) => [u(`/activities/${slug}/draw`, 'POST'), u(`/activities/${slug}/draw`, 'POST')]));
const ok = results.filter((r) => r.status === 200).length;
const errors500 = results.filter((r) => r.status >= 500);
check(errors500.length === 0, `no 5xx under concurrency (${errors500.map((r) => r.data?.error).join(', ')})`);
check(ok <= N, `double taps spend at most one credit each (${ok} successful draws for ${N} users)`);

const [[dup]] = await db.query(`SELECT COUNT(*) AS n FROM (
  SELECT capsule_id FROM draws d JOIN capsules c ON c.id = d.capsule_id WHERE c.is_special = FALSE GROUP BY capsule_id HAVING COUNT(*) > 1) x`);
check(Number(dup.n) === 0, 'no normal capsule drawn twice');
const [[self]] = await db.query('SELECT COUNT(*) AS n FROM draws d JOIN capsules c ON c.id = d.capsule_id WHERE c.user_id = d.drawer_id');
check(Number(self.n) === 0, 'nobody drew their own capsule');
const [[over]] = await db.query('SELECT COUNT(*) AS n FROM capsules WHERE draw_count > max_draws');
check(Number(over.n) === 0, 'no capsule exceeds max_draws');
const [[neg]] = await db.query(`SELECT COUNT(*) AS n FROM users u WHERE
  (SELECT COUNT(*) FROM draws WHERE drawer_id = u.id) > (SELECT COUNT(*) FROM capsules WHERE user_id = u.id AND status <> 'removed')`);
check(Number(neg.n) === 0, 'nobody drew more times than they dropped');

// --- round closed
await admin(`/admin/rounds/${round.id}/end`, 'POST');
check((await a(`/activities/${slug}/capsules`, 'POST', capsule('late'))).status === 409, 'cannot drop after round ends');
const meAfter = (await b(`/activities/${slug}/me`)).data;
check(meAfter.round === null && meAfter.myDraws.length === 1, 'after round ends, drawn capsules still visible');

await db.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
