// Load test of the real draw API (decision 36). Admin-only, and only when LOAD_TEST=1 on a
// non-production server; otherwise every route here answers 404 as if it didn't exist.
// setup creates an isolated QR point, test users with one capsule each, and sessions for them
// (the same rows a real login creates), so scripts/load-draw.mjs can draw as those users without
// emailed codes. report checks the draw rules in the database; DELETE removes all of it.
import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, tx } from './db.js';
import { requireAdmin } from './auth.js';
import { env, isProd, FEATURES } from './config.js';
import { HttpError } from './errors.js';
import { newSlug } from './admin.js';

const POINT_PREFIX = '【壓測】';
const EMAIL_DOMAIN = '@loadtest.invalid'; // .invalid is reserved: these addresses can never receive mail
const SESSION_MS = 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enabled = () => env.LOAD_TEST?.trim() === '1' && !isProd;

export const loadtestRouter = Router();

loadtestRouter.use((req, res, next) => {
  if (!enabled()) return res.status(404).json({ error: 'not found' });
  requireAdmin(req, res, next);
});

async function testRound(conn = pool) {
  const [[round]] = await conn.query(
    `SELECT r.id, r.starts_at, a.slug FROM rounds r JOIN activities a ON a.id = r.activity_id
     WHERE a.name LIKE ? ORDER BY r.id DESC LIMIT 1`,
    [`${POINT_PREFIX}%`],
  );
  return round || null;
}

const intIn = (v, def, min, max) => {
  const n = v === undefined ? def : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `數值要在 ${min}–${max} 之間`);
  return n;
};

loadtestRouter.post('/setup', async (req, res) => {
  if (FEATURES.drawNotifyMail) throw new HttpError(409, 'DRAW_NOTIFY_MAIL 開著，壓測會寄出大量通知信。請先關閉再測。');
  const users = intIn(req.body?.users, 200, 2, 500);
  const perUser = intIn(req.body?.capsulesPerUser, 1, 1, 5);

  const result = await tx(async (conn) => {
    if (await testRound(conn)) throw new HttpError(409, '上一次的壓測資料還在，請先清除（DELETE /api/admin/loadtest）');
    const now = Date.now();
    const [p] = await conn.query('INSERT INTO activities SET ?', [{
      slug: newSlug(), name: `${POINT_PREFIX}多人搶扭蛋`, organizer_name: '壓測', organizer_contact: 'loadtest',
    }]);
    const [r] = await conn.query('INSERT INTO rounds (activity_id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)', [
      p.insertId, '壓測', new Date(now - 60 * 1000), new Date(now + 2 * 60 * 60 * 1000),
    ]);

    const pad = (i) => String(i + 1).padStart(3, '0');
    const emails = Array.from({ length: users }, (_, i) => `lt-${pad(i)}${EMAIL_DOMAIN}`);
    await conn.query('INSERT INTO users (email, nickname, region, line_id, consent_at) VALUES ?', [
      emails.map((e, i) => [e, `壓測${pad(i)}`, '測試', `lt${pad(i)}`, new Date(now)]),
    ]);
    const [rows] = await conn.query('SELECT id, email FROM users WHERE email IN (?)', [emails]);
    const idByEmail = new Map(rows.map((u) => [u.email, u.id]));
    const userIds = emails.map((e) => idByEmail.get(e));

    await conn.query('INSERT INTO capsules (round_id, user_id, category, title, description, duration) VALUES ?', [
      userIds.flatMap((id, i) => Array.from({ length: perUser }, (_, k) => [
        r.insertId, id, 'skill', `壓測蛋 ${pad(i)}-${k + 1}`, '壓力測試用的扭蛋', '1h',
      ])),
    ]);

    // Same as a real login (see startSession in auth.js): the browser gets the token, the DB keeps its hash.
    const tokens = userIds.map(() => crypto.randomBytes(32).toString('base64url'));
    await conn.query('INSERT INTO sessions (token_hash, email, is_admin, expires_at) VALUES ?', [
      tokens.map((t, i) => [sha256(t), emails[i], false, new Date(now + SESSION_MS)]),
    ]);
    const [[point]] = await conn.query('SELECT slug FROM activities WHERE id = ?', [p.insertId]);
    return { slug: point.slug, roundId: r.insertId, poolSize: users * perUser, userIds, tokens };
  });
  res.status(201).json(result);
});

// Checks every draw rule against the database. Body: { results: [{ userId, drawId, capsuleId }], startedAt }
// where results are the successful draws the script received.
loadtestRouter.post('/report', async (req, res) => {
  const round = await testRound();
  if (!round) throw new HttpError(404, '沒有壓測資料');
  const rid = round.id;
  const startedAt = new Date(req.body?.startedAt || round.starts_at);
  const reported = Array.isArray(req.body?.results) ? req.body.results : [];
  const q = async (sql, params = []) => (await pool.query(sql, params))[0];

  const dupNormal = await q(
    `SELECT d.capsule_id, COUNT(*) AS n FROM draws d JOIN capsules c ON c.id = d.capsule_id
     WHERE d.round_id = ? AND c.is_special = FALSE GROUP BY d.capsule_id HAVING n > 1`, [rid]);
  const self = await q(
    'SELECT d.id FROM draws d JOIN capsules c ON c.id = d.capsule_id WHERE d.round_id = ? AND c.user_id = d.drawer_id', [rid]);
  const overdrawn = await q(
    `SELECT u.id, u.email,
       (SELECT COUNT(*) FROM capsules c WHERE c.user_id = u.id AND c.round_id = ? AND c.status <> 'removed') AS dropped,
       (SELECT COUNT(*) FROM draws d WHERE d.drawer_id = u.id AND d.round_id = ?) AS drew
     FROM users u WHERE u.email LIKE ? HAVING drew > dropped`, [rid, rid, `%${EMAIL_DOMAIN}`]);
  const overSpecial = await q(
    'SELECT id, draw_count, max_draws FROM capsules WHERE round_id = ? AND draw_count > max_draws', [rid]);
  const badCount = await q(
    `SELECT c.id, c.draw_count, (SELECT COUNT(*) FROM draws d WHERE d.capsule_id = c.id) AS actual
     FROM capsules c WHERE c.round_id = ? HAVING c.draw_count <> actual`, [rid]);
  const badStatus = await q(
    `SELECT id, status, draw_count, max_draws FROM capsules WHERE round_id = ? AND status <> 'removed'
       AND (status = 'drawn') <> (draw_count >= max_draws)`, [rid]);

  const dbDraws = await q('SELECT id, capsule_id, drawer_id FROM draws WHERE round_id = ?', [rid]);
  const dbKey = new Set(dbDraws.map((d) => `${d.id}:${d.capsule_id}:${d.drawer_id}`));
  const apiKey = new Set(reported.map((r) => `${r.drawId}:${r.capsuleId}:${r.userId}`));
  const missingInDb = [...apiKey].filter((k) => !dbKey.has(k));
  const missingInApi = [...dbKey].filter((k) => !apiKey.has(k));

  const errors = await q('SELECT created_at, source, method, path, message FROM error_logs WHERE created_at >= ? ORDER BY id', [startedAt]);
  const metrics = await q(
    `SELECT minute, SUM(requests) AS requests, SUM(status_5xx) AS status_5xx, MAX(p95_ms) AS p95_ms,
            SUM(max_in_flight) AS max_in_flight, SUM(rss_mb) AS rss_mb, SUM(db_max_busy) AS db_max_busy,
            SUM(db_waits) AS db_waits, MAX(loop_p99_ms) AS loop_p99_ms
     FROM metrics WHERE minute >= ? - INTERVAL 1 MINUTE GROUP BY minute ORDER BY minute`, [startedAt]);
  const [[left]] = await pool.query("SELECT COUNT(*) AS n FROM capsules WHERE round_id = ? AND status = 'open'", [rid]);

  const check = (name, bad, detail) => ({ name, ok: bad.length === 0, detail: bad.length ? detail(bad) : null });
  res.json({
    checks: [
      check('一般蛋沒有被抽兩次', dupNormal, (b) => `${b.length} 顆被重複抽：${b.slice(0, 10).map((x) => `#${x.capsule_id}×${x.n}`).join(', ')}`),
      check('沒有抽到自己的蛋', self, (b) => `${b.length} 筆抽到自己的蛋`),
      check('沒有多抽（抽取次數 ≤ 投蛋數）', overdrawn, (b) => `${b.length} 人多抽：${b.slice(0, 10).map((x) => `${x.email} ${x.drew}/${x.dropped}`).join(', ')}`),
      check('特別蛋沒有超過可抽次數', overSpecial, (b) => `${b.length} 顆超過`),
      check('蛋的抽取計數等於實際紀錄', badCount, (b) => `${b.length} 顆不一致`),
      check('蛋的狀態正確（抽滿才是已抽）', badStatus, (b) => `${b.length} 顆狀態不對`),
      check('API 回應的每一筆，資料庫都有', missingInDb, (b) => `${b.length} 筆只有 API 有`),
      check('資料庫的每一筆，API 都有回應', missingInApi, (b) => `${b.length} 筆只有資料庫有（多半是腳本那邊逾時，伺服器其實抽成功了）`),
      check('壓測期間沒有新的錯誤紀錄', errors, (b) => `${b.length} 筆：${[...new Set(b.map((e) => e.message))].slice(0, 5).join(' / ')}`),
    ],
    draws: dbDraws.length,
    poolLeft: Number(left.n),
    errors,
    metrics,
  });
});

loadtestRouter.delete('/', async (req, res) => {
  const deleted = await tx(async (conn) => {
    const like = `${POINT_PREFIX}%`;
    const emailLike = `%${EMAIL_DOMAIN}`;
    const n = {};
    const run = async (key, sql, params) => { n[key] = (await conn.query(sql, params))[0].affectedRows; };
    const roundsSql = 'SELECT r.id FROM rounds r JOIN activities a ON a.id = r.activity_id WHERE a.name LIKE ?';
    // MySQL can't delete from a table it also reads in a subquery, hence the derived tables.
    await run('draws', `DELETE FROM draws WHERE round_id IN (SELECT id FROM (${roundsSql}) x)
      OR drawer_id IN (SELECT id FROM (SELECT id FROM users WHERE email LIKE ?) y)`, [like, emailLike]);
    await run('capsules', `DELETE FROM capsules WHERE round_id IN (SELECT id FROM (${roundsSql}) x)
      OR user_id IN (SELECT id FROM (SELECT id FROM users WHERE email LIKE ?) y)`, [like, emailLike]);
    await run('rounds', `DELETE FROM rounds WHERE id IN (SELECT id FROM (${roundsSql}) x)`, [like]);
    await run('activities', 'DELETE FROM activities WHERE name LIKE ?', [like]);
    await run('sessions', 'DELETE FROM sessions WHERE email LIKE ?', [emailLike]);
    await run('users', 'DELETE FROM users WHERE email LIKE ?', [emailLike]);
    return n;
  });
  res.json({ ok: true, deleted });
});
