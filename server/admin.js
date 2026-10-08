import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, tx } from './db.js';
import { sendMail } from './mail.js';
import { requireAdmin } from './auth.js';
import { CATEGORIES, DURATIONS } from './config.js';
import { HttpError } from './errors.js';
import { withStatus, parseRange, assertNoOverlap, roundStatus } from './rounds.js';

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
  if (!round) throw new HttpError(404, '找不到這個活動');
  return round;
}

// ---- QR points (table: activities) ----

adminRouter.get('/activities', async (req, res) => {
  const [points] = await pool.query('SELECT * FROM activities ORDER BY name');
  const [rounds] = await pool.query('SELECT id, activity_id, name, starts_at, ends_at FROM rounds ORDER BY starts_at');
  res.json(points.map((a) => {
    const mine = rounds.filter((r) => r.activity_id === a.id).map(withStatus);
    return {
      ...a,
      round_count: mine.length,
      current_round: mine.find((r) => r.status === 'ongoing') || null,
      next_round: mine.find((r) => r.status === 'upcoming') || null,
    };
  }));
});

// Validates QR point fields. The QR id (slug) is always generated and never changes, since it's printed in the QR code.
function pointFields(b) {
  const fields = {
    name: str(b?.name, 100),
    organizer_name: str(b?.organizer_name, 100),
    organizer_contact: str(b?.organizer_contact, 255),
  };
  if (!fields.name || !fields.organizer_name || !fields.organizer_contact) {
    throw new HttpError(400, 'QR 點位名稱、主辦方名稱、主辦方聯絡方式都要填');
  }
  return { ...fields, slug: newSlug() };
}

async function insertPoint(conn, fields) {
  try {
    const [r] = await conn.query('INSERT INTO activities SET ?', [fields]);
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'QR 代碼剛好重複了，請再按一次建立');
    throw err;
  }
}

adminRouter.post('/activities', async (req, res) => {
  const fields = pointFields(req.body);
  const id = await insertPoint(pool, fields);
  res.status(201).json({ id, slug: fields.slug });
});

adminRouter.get('/activities/:id', async (req, res) => {
  const [[point]] = await pool.query('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!point) throw new HttpError(404, '找不到這個 QR 點位');
  const [rounds] = await pool.query('SELECT * FROM rounds WHERE activity_id = ? ORDER BY starts_at DESC', [point.id]);
  res.json({ ...point, rounds: rounds.map(withStatus) });
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
  if (!r.affectedRows) throw new HttpError(404, '找不到這個 QR 點位');
  res.json({ ok: true });
});

// ---- Events (table: rounds) ----

const ROUND_LIST_SQL = `
  SELECT r.*, a.name AS point_name, a.slug AS point_slug,
         a.organizer_name AS point_organizer_name, a.organizer_contact AS point_organizer_contact,
         (SELECT COUNT(*) FROM capsules WHERE round_id = r.id) AS capsule_count
  FROM rounds r JOIN activities a ON a.id = r.activity_id`;

adminRouter.get('/rounds', async (req, res) => {
  const [rows] = await pool.query(`${ROUND_LIST_SQL} ORDER BY r.starts_at DESC`);
  res.json(rows.map(withStatus));
});

adminRouter.get('/rounds/:id', async (req, res) => {
  const [[row]] = await pool.query(`${ROUND_LIST_SQL} WHERE r.id = ?`, [req.params.id]);
  if (!row) throw new HttpError(404, '找不到這個活動');
  res.json(withStatus(row));
});

// New event: pick an existing QR point (activity_id) or create one inline (point: {...}).
adminRouter.post('/rounds', async (req, res) => {
  const name = str(req.body?.name, 100);
  if (!name) throw new HttpError(400, '請填活動名稱');
  const { startsAt, endsAt } = parseRange(req.body);
  const newPoint = req.body?.point ? pointFields(req.body.point) : null;
  const id = await tx(async (conn) => {
    const pointId = newPoint ? await insertPoint(conn, newPoint) : Number(req.body?.activity_id);
    // Lock the QR point so two admins can't create overlapping events at once.
    const [[point]] = await conn.query('SELECT id FROM activities WHERE id = ? FOR UPDATE', [pointId]);
    if (!point) throw new HttpError(400, '請選一個 QR 點位');
    await assertNoOverlap(conn, point.id, startsAt, endsAt);
    const [r] = await conn.query('INSERT INTO rounds (activity_id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)', [point.id, name, startsAt, endsAt]);
    return r.insertId;
  });
  res.status(201).json({ id });
});

// Rename or reschedule an event, and optionally edit its QR point (point: {...}) in the same transaction.
// An event that has started keeps its start time.
adminRouter.patch('/rounds/:id', async (req, res) => {
  await tx(async (conn) => {
    const [[round]] = await conn.query('SELECT * FROM rounds WHERE id = ?', [req.params.id]);
    if (!round) throw new HttpError(404, '找不到這個活動');
    await conn.query('SELECT id FROM activities WHERE id = ? FOR UPDATE', [round.activity_id]);
    const fields = {};
    if (req.body?.name !== undefined) {
      fields.name = str(req.body.name, 100);
      if (!fields.name) throw new HttpError(400, '活動名稱不能空白');
    }
    if (req.body?.starts_at !== undefined || req.body?.ends_at !== undefined) {
      const { startsAt, endsAt } = parseRange({
        starts_at: req.body.starts_at ?? round.starts_at,
        ends_at: req.body.ends_at ?? round.ends_at,
      });
      if (roundStatus(round) !== 'upcoming' && startsAt.getTime() !== new Date(round.starts_at).getTime()) {
        throw new HttpError(409, '活動已經開始，不能改開始時間');
      }
      await assertNoOverlap(conn, round.activity_id, startsAt, endsAt, round.id);
      fields.starts_at = startsAt;
      fields.ends_at = endsAt;
    }
    if (req.body?.point) {
      const { slug, ...pointUpdate } = pointFields(req.body.point); // slug is fixed; ignore the generated one
      await conn.query('UPDATE activities SET ? WHERE id = ?', [pointUpdate, round.activity_id]);
    }
    if (Object.keys(fields).length) await conn.query('UPDATE rounds SET ? WHERE id = ?', [fields, round.id]);
    else if (!req.body?.point) throw new HttpError(400, '沒有要更新的欄位');
  });
  res.json({ ok: true });
});

adminRouter.post('/rounds/:id/end', async (req, res) => {
  const [r] = await pool.query(
    'UPDATE rounds SET ends_at = UTC_TIMESTAMP() WHERE id = ? AND starts_at <= UTC_TIMESTAMP() AND ends_at > UTC_TIMESTAMP()',
    [req.params.id],
  );
  if (!r.affectedRows) throw new HttpError(409, '這個活動不在進行中');
  res.json({ ok: true });
});

// Only events without capsules can be deleted, so no capsule or draw ever loses its event.
adminRouter.delete('/rounds/:id', async (req, res) => {
  const [r] = await pool.query(
    'DELETE FROM rounds WHERE id = ? AND NOT EXISTS (SELECT 1 FROM capsules WHERE round_id = ?)',
    [req.params.id, req.params.id],
  );
  if (!r.affectedRows) throw new HttpError(409, '活動不存在，或已經有扭蛋，不能刪除');
  res.status(204).end();
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
    round: withStatus(round),
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
  // Organizer capsules can be prepared before a round starts, but not added after it ends.
  if (roundStatus(round) === 'ended') throw new HttpError(409, '這個活動已經結束');
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

