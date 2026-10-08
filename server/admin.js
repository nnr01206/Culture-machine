import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, tx } from './db.js';
import { sendMail } from './mail.js';
import { requireAdmin } from './auth.js';
import { CATEGORIES, DURATIONS } from './config.js';
import { HttpError } from './errors.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const str = (v, max) => {
  const s = String(v ?? '').trim();
  return max ? s.slice(0, max) : s;
};

// 10 chars from an unambiguous alphabet, shaped like "abcd-efghj".
function newSlug() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => alphabet[crypto.randomInt(alphabet.length)];
  const part = (n) => Array.from({ length: n }, pick).join('');
  return `${part(4)}-${part(5)}`;
}

async function getRound(id) {
  const [[round]] = await pool.query('SELECT * FROM rounds WHERE id = ?', [id]);
  if (!round) throw new HttpError(404, '找不到這一輪');
  return round;
}

// ---- Activities ----

adminRouter.get('/activities', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT a.*,
           r.id AS open_round_id, r.name AS open_round_name,
           (SELECT COUNT(*) FROM rounds WHERE activity_id = a.id) AS round_count
    FROM activities a
    LEFT JOIN rounds r ON r.activity_id = a.id AND r.is_open = TRUE
    ORDER BY a.id DESC
  `);
  res.json(rows);
});

adminRouter.post('/activities', async (req, res) => {
  const name = str(req.body?.name, 100);
  const organizerName = str(req.body?.organizer_name, 100);
  const organizerContact = str(req.body?.organizer_contact, 255);
  if (!name || !organizerName || !organizerContact) throw new HttpError(400, '名稱、主辦方名稱、主辦方聯絡方式都要填');
  const slug = newSlug();
  const [r] = await pool.query(
    'INSERT INTO activities (slug, name, organizer_name, organizer_contact) VALUES (?, ?, ?, ?)',
    [slug, name, organizerName, organizerContact],
  );
  res.status(201).json({ id: r.insertId, slug });
});

adminRouter.get('/activities/:id', async (req, res) => {
  const [[activity]] = await pool.query('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!activity) throw new HttpError(404, '找不到這個活動');
  const [rounds] = await pool.query('SELECT * FROM rounds WHERE activity_id = ? ORDER BY id DESC', [activity.id]);
  res.json({ ...activity, rounds });
});

adminRouter.patch('/activities/:id', async (req, res) => {
  const fields = {};
  if (req.body?.name !== undefined) fields.name = str(req.body.name, 100);
  if (req.body?.organizer_name !== undefined) fields.organizer_name = str(req.body.organizer_name, 100);
  if (req.body?.organizer_contact !== undefined) fields.organizer_contact = str(req.body.organizer_contact, 255);
  if (req.body?.per_user_limit !== undefined) {
    const n = req.body.per_user_limit === null || req.body.per_user_limit === '' ? null : Number(req.body.per_user_limit);
    if (n !== null && !(Number.isInteger(n) && n > 0)) throw new HttpError(400, '上限要是正整數或留空');
    fields.per_user_limit = n;
  }
  if (Object.values(fields).some((v) => v === '')) throw new HttpError(400, '欄位不能空白');
  if (!Object.keys(fields).length) throw new HttpError(400, '沒有要更新的欄位');
  const [r] = await pool.query('UPDATE activities SET ? WHERE id = ?', [fields, req.params.id]);
  if (!r.affectedRows) throw new HttpError(404, '找不到這個活動');
  res.json({ ok: true });
});

// ---- Rounds ----

adminRouter.post('/activities/:id/rounds', async (req, res) => {
  const name = str(req.body?.name, 100);
  if (!name) throw new HttpError(400, '請填這一輪的名稱');
  const id = await tx(async (conn) => {
    // Lock the activity row so two admins can't open two rounds at once.
    const [[activity]] = await conn.query('SELECT id FROM activities WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!activity) throw new HttpError(404, '找不到這個活動');
    const [[open]] = await conn.query('SELECT id FROM rounds WHERE activity_id = ? AND is_open = TRUE', [activity.id]);
    if (open) throw new HttpError(409, '這個活動還有進行中的輪次，請先結束');
    const [r] = await conn.query('INSERT INTO rounds (activity_id, name) VALUES (?, ?)', [activity.id, name]);
    return r.insertId;
  });
  res.status(201).json({ id });
});

adminRouter.post('/rounds/:id/end', async (req, res) => {
  const [r] = await pool.query(
    'UPDATE rounds SET is_open = FALSE, ends_at = UTC_TIMESTAMP() WHERE id = ? AND is_open = TRUE',
    [req.params.id],
  );
  if (!r.affectedRows) throw new HttpError(409, '這一輪不存在或已經結束');
  res.json({ ok: true });
});

adminRouter.get('/rounds/:id/overview', async (req, res) => {
  const round = await getRound(req.params.id);
  const [[counts]] = await pool.query(`
    SELECT
      (SELECT COUNT(DISTINCT user_id) FROM capsules WHERE round_id = ? AND user_id IS NOT NULL) AS participants,
      SUM(is_special = FALSE AND status <> 'removed') AS total,
      SUM(is_special = FALSE AND status = 'open') AS open,
      SUM(is_special = FALSE AND status = 'drawn') AS drawn,
      SUM(is_special = FALSE AND status = 'removed') AS removed,
      SUM(CASE WHEN is_special AND status = 'open' THEN max_draws - draw_count ELSE 0 END) AS special_remaining
    FROM capsules WHERE round_id = ?
  `, [round.id, round.id]);
  const [[draws]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed FROM draws WHERE round_id = ?",
    [round.id],
  );
  const [byCategory] = await pool.query(`
    SELECT category, COUNT(*) AS count FROM capsules
    WHERE round_id = ? AND is_special = FALSE AND status <> 'removed'
    GROUP BY category
  `, [round.id]);
  const num = (v) => Number(v || 0);
  res.json({
    round,
    participants: num(counts.participants),
    capsules: { total: num(counts.total), open: num(counts.open), drawn: num(counts.drawn), removed: num(counts.removed) },
    specialRemaining: num(counts.special_remaining),
    draws: { total: num(draws.total), completed: num(draws.completed) },
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, num(byCategory.find((r) => r.category === c)?.count)])),
  });
});

// ---- Capsules ----

adminRouter.get('/rounds/:id/capsules', async (req, res) => {
  const where = ['c.round_id = ?'];
  const params = [req.params.id];
  if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  if (req.query.category) { where.push('c.category = ?'); params.push(req.query.category); }
  const [rows] = await pool.query(`
    SELECT c.*, u.nickname, u.email
    FROM capsules c LEFT JOIN users u ON u.id = c.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.id DESC
  `, params);
  res.json(rows);
});

// Admins only create organizer capsules (decision 19); special = fallback with a draw quota (decision 8).
adminRouter.post('/rounds/:id/capsules', async (req, res) => {
  const round = await getRound(req.params.id);
  if (!round.is_open) throw new HttpError(409, '這一輪已經結束');
  const b = req.body || {};
  const category = str(b.category);
  const duration = str(b.duration);
  const title = str(b.title, 100);
  const description = str(b.description);
  const conditions = str(b.conditions) || null;
  const isSpecial = Boolean(b.is_special);
  const maxDraws = isSpecial ? Number(b.max_draws) : 1;
  if (!CATEGORIES.includes(category)) throw new HttpError(400, '類別不正確');
  if (!DURATIONS.includes(duration)) throw new HttpError(400, '時間選項不正確');
  if (!title || !description) throw new HttpError(400, '標題和內容說明都要填');
  if (!(Number.isInteger(maxDraws) && maxDraws >= 1 && maxDraws <= 999)) throw new HttpError(400, '可抽次數要是 1–999');
  const [r] = await pool.query(
    `INSERT INTO capsules (round_id, user_id, category, title, description, duration, conditions, is_special, max_draws)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [round.id, category, title, description, duration, conditions, isSpecial, maxDraws],
  );
  res.status(201).json({ id: r.insertId });
});

adminRouter.post('/capsules/:id/remove', async (req, res) => {
  const [r] = await pool.query("UPDATE capsules SET status = 'removed' WHERE id = ? AND status <> 'removed'", [req.params.id]);
  if (!r.affectedRows) throw new HttpError(409, '扭蛋不存在或已經下架');
  res.json({ ok: true });
});

// Reopen puts a capsule back in the pool with one more draw available, even if it was drawn before.
adminRouter.post('/capsules/:id/reopen', async (req, res) => {
  const [r] = await pool.query(
    `UPDATE capsules
     SET status = 'open', max_draws = GREATEST(max_draws, draw_count + 1)
     WHERE id = ? AND status <> 'open'`,
    [req.params.id],
  );
  if (!r.affectedRows) throw new HttpError(409, '扭蛋不存在或已經是可抽取');
  res.json({ ok: true });
});

// ---- Participants & draws ----

adminRouter.get('/rounds/:id/participants', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT u.id, u.nickname, u.email, u.region,
           COUNT(DISTINCT c.id) AS capsule_count,
           (SELECT COUNT(*) FROM draws d WHERE d.drawer_id = u.id AND d.round_id = ?) AS draw_count
    FROM users u
    JOIN capsules c ON c.user_id = u.id AND c.round_id = ?
    GROUP BY u.id
    ORDER BY u.id DESC
  `, [req.params.id, req.params.id]);
  res.json(rows);
});

adminRouter.get('/rounds/:id/draws', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT d.id, d.status, d.created_at,
           c.id AS capsule_id, c.title, c.category, c.is_special,
           drawer.nickname AS drawer_nickname, drawer.email AS drawer_email,
           provider.nickname AS provider_nickname
    FROM draws d
    JOIN capsules c ON c.id = d.capsule_id
    JOIN users drawer ON drawer.id = d.drawer_id
    LEFT JOIN users provider ON provider.id = c.user_id
    WHERE d.round_id = ?
    ORDER BY d.id DESC
  `, [req.params.id]);
  res.json(rows);
});

// ---- Mail test ----

adminRouter.post('/mail-test', async (req, res) => {
  const to = str(req.body?.to);
  if (!to) throw new HttpError(400, '請填收件 Email');
  const info = await sendMail({
    to,
    subject: '文化扭蛋機 SMTP 測試',
    text: '如果你收到這封信，主機的 SMTP 可以用。請順便看看它有沒有掉進垃圾信匣。',
  });
  res.json({ ok: true, messageId: info.messageId, response: info.response });
});

