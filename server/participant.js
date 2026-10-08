import { Router } from 'express';
import { pool, tx } from './db.js';
import { sendMail } from './mail.js';
import { CATEGORIES, DURATIONS } from './config.js';
import { HttpError } from './errors.js';
import { currentRound } from './rounds.js';

export const participantRouter = Router();

const str = (v, max) => {
  const s = String(v ?? '').trim();
  return max ? s.slice(0, max) : s;
};

const CATEGORY_LABEL = { skill: '技能', time: '時間', space: '空間', knowledge: '知識', object: '物件', companion: '陪伴', experience: '經驗', connection: '連結', creativity: '創意' };
const DURATION_LABEL = { '30m': '30 分鐘', '1h': '1 小時', '2h': '2 小時', '3h': '3 小時', half_day: '半天（約 4–5 小時）', none: '不需要特定時間' };

function requireParticipant(req, res, next) {
  if (!req.session) throw new HttpError(401, '請先登入');
  if (req.session.isAdmin) throw new HttpError(403, '管理者帳號不參與抽蛋，請用一般信箱登入');
  next();
}

async function loadUser(email) {
  const [[u]] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  return u || null;
}

async function requireProfile(req, res, next) {
  req.user = await loadUser(req.session.email);
  if (!req.user) throw new HttpError(409, '請先填寫基本資料');
  next();
}

async function getActivity(slug) {
  const [[activity]] = await pool.query('SELECT * FROM activities WHERE slug = ?', [slug]);
  if (!activity) throw new HttpError(404, '找不到這個 QR Code 對應的地點');
  return { activity, round: await currentRound(activity.id) };
}

// Contact details shown only after a draw (decisions 2, 15).
function contactOf(u) {
  return {
    nickname: u.nickname,
    region: u.region,
    bio: u.bio,
    line_id: u.line_id,
    instagram: u.instagram,
    phone: u.phone,
    email: u.show_email ? u.email : null,
  };
}

const organizerContact = (activity) => ({
  nickname: activity.organizer_name,
  region: null,
  bio: null,
  organizer: true,
  contact: activity.organizer_contact,
});

// Credits = capsules dropped this round (not taken down) − draws made this round (decisions 3, 4).
async function creditsOf(conn, userId, roundId) {
  const [[r]] = await conn.query(
    `SELECT
       (SELECT COUNT(*) FROM capsules WHERE user_id = ? AND round_id = ? AND status <> 'removed') -
       (SELECT COUNT(*) FROM draws WHERE drawer_id = ? AND round_id = ?) AS credits`,
    [userId, roundId, userId, roundId],
  );
  return Math.max(0, Number(r.credits));
}

// ---- Profile ----

participantRouter.put('/me/profile', requireParticipant, async (req, res) => {
  const b = req.body || {};
  const fields = {
    nickname: str(b.nickname, 50),
    region: str(b.region, 50),
    bio: str(b.bio, 200) || null,
    line_id: str(b.line_id, 100) || null,
    instagram: str(b.instagram, 100) || null,
    phone: str(b.phone, 30) || null,
    show_email: Boolean(b.show_email),
  };
  if (!fields.nickname || !fields.region) throw new HttpError(400, '暱稱和所在地區都要填');
  if (!fields.line_id && !fields.instagram) throw new HttpError(400, 'LINE ID 和 Instagram 至少填一種，抽中後對方才找得到你');

  const existing = await loadUser(req.session.email);
  if (existing) {
    await pool.query('UPDATE users SET ? WHERE id = ?', [fields, existing.id]);
  } else {
    if (!b.consent) throw new HttpError(400, '請先閱讀並同意個資使用說明');
    await pool.query('INSERT INTO users SET ?', [{ ...fields, email: req.session.email, consent_at: new Date() }]);
  }
  res.json({ ok: true });
});

// ---- Activity state for the logged-in participant ----

participantRouter.get('/activities/:slug/me', requireParticipant, requireProfile, async (req, res) => {
  const { activity, round } = await getActivity(req.params.slug);
  const credits = round ? await creditsOf(pool, req.user.id, round.id) : 0;

  // Capsules I dropped in this activity (all rounds), with who drew them.
  const [mine] = await pool.query(
    `SELECT c.id, c.title, c.category, c.duration, c.description, c.conditions, c.status, c.created_at,
            r.name AS round_name
     FROM capsules c JOIN rounds r ON r.id = c.round_id
     WHERE c.user_id = ? AND r.activity_id = ?
     ORDER BY c.id DESC`,
    [req.user.id, activity.id],
  );
  const [drawers] = mine.length
    ? await pool.query(
      `SELECT d.capsule_id, d.created_at, u.*
       FROM draws d JOIN users u ON u.id = d.drawer_id
       WHERE d.capsule_id IN (?) ORDER BY d.id`,
      [mine.map((c) => c.id)],
    )
    : [[]];

  // What I drew in this activity (all rounds — drawn capsules never expire, decision 7).
  const [drawn] = await pool.query(
    `SELECT d.id AS draw_id, d.created_at AS drawn_at, r.name AS round_name,
            c.id, c.title, c.category, c.duration, c.description, c.conditions, c.user_id, c.is_special,
            u.nickname, u.region, u.bio, u.line_id, u.instagram, u.phone, u.email, u.show_email
     FROM draws d
     JOIN capsules c ON c.id = d.capsule_id
     JOIN rounds r ON r.id = d.round_id
     LEFT JOIN users u ON u.id = c.user_id
     WHERE d.drawer_id = ? AND r.activity_id = ?
     ORDER BY d.id DESC`,
    [req.user.id, activity.id],
  );

  res.json({
    profile: contactOf(req.user),
    round: round ? { id: round.id, name: round.name, starts_at: round.starts_at, ends_at: round.ends_at } : null,
    credits,
    myCapsules: mine.map((c) => ({
      ...c,
      drawnBy: drawers.filter((d) => d.capsule_id === c.id).map((d) => ({ ...contactOf(d), drawn_at: d.created_at })),
    })),
    myDraws: drawn.map((d) => ({
      draw_id: d.draw_id,
      drawn_at: d.drawn_at,
      round_name: d.round_name,
      capsule: { id: d.id, title: d.title, category: d.category, duration: d.duration, description: d.description, conditions: d.conditions, is_special: Boolean(d.is_special) },
      provider: d.user_id ? contactOf(d) : organizerContact(activity),
    })),
  });
});

// ---- Drop a capsule (immutable once dropped, decision 16; no review, decision 21) ----

participantRouter.post('/activities/:slug/capsules', requireParticipant, requireProfile, async (req, res) => {
  const { activity, round } = await getActivity(req.params.slug);
  if (!round) throw new HttpError(409, '目前沒有進行中的活動，下一場活動開始後再來投入');

  const b = req.body || {};
  const category = str(b.category);
  const duration = str(b.duration);
  const title = str(b.title, 100);
  const description = str(b.description, 1000);
  const conditions = str(b.conditions, 500) || null;
  if (!CATEGORIES.includes(category)) throw new HttpError(400, '請選一個類別');
  if (!DURATIONS.includes(duration)) throw new HttpError(400, '請選需要多少時間');
  if (!title || !description) throw new HttpError(400, '「我願意提供什麼」和「內容說明」都要填');

  const id = await tx(async (conn) => {
    // Serialize this user's writes so the per-round limit can't be raced.
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    if (activity.per_user_limit) {
      const [[{ n }]] = await conn.query(
        "SELECT COUNT(*) AS n FROM capsules WHERE user_id = ? AND round_id = ? AND status <> 'removed'",
        [req.user.id, round.id],
      );
      if (n >= activity.per_user_limit) throw new HttpError(409, `這場活動每人最多投入 ${activity.per_user_limit} 顆`);
    }
    const [r] = await conn.query(
      `INSERT INTO capsules (round_id, user_id, category, title, description, duration, conditions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [round.id, req.user.id, category, title, description, duration, conditions],
    );
    return r.insertId;
  });
  res.status(201).json({ id, credits: await creditsOf(pool, req.user.id, round.id) });
});

// ---- Draw ----

// Claims one random drawable capsule. FOR UPDATE makes this a locking read: it sees the latest
// committed rows (not the transaction's snapshot) and holds the candidates until commit, so two
// concurrent draws in a round queue up instead of winning the same capsule. Fine at event scale.
async function claimRandom(conn, roundId, userId, special) {
  const [[candidate]] = await conn.query(
    `SELECT c.id FROM capsules c
     WHERE c.round_id = ? AND c.status = 'open' AND c.is_special = ? AND c.draw_count < c.max_draws
       AND (c.user_id IS NULL OR c.user_id <> ?)
       AND NOT EXISTS (SELECT 1 FROM draws d WHERE d.capsule_id = c.id AND d.drawer_id = ?)
     ORDER BY RAND() LIMIT 1
     FOR UPDATE`,
    [roundId, special, userId, userId],
  );
  if (!candidate) return null;
  // status is computed from the pre-increment draw_count, so assignment order doesn't matter.
  await conn.query(
    `UPDATE capsules
     SET status = IF(draw_count + 1 >= max_draws, 'drawn', 'open'), draw_count = draw_count + 1
     WHERE id = ?`,
    [candidate.id],
  );
  return candidate.id;
}

// Locking reads can occasionally deadlock under contention; MySQL rolls one side back, so retry it.
async function txWithRetry(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await tx(fn);
    } catch (err) {
      if (err.code !== 'ER_LOCK_DEADLOCK' || i >= attempts) throw err;
    }
  }
}

participantRouter.post('/activities/:slug/draw', requireParticipant, requireProfile, async (req, res) => {
  const { activity, round } = await getActivity(req.params.slug);
  if (!round) throw new HttpError(409, '目前沒有進行中的活動，不能抽了');

  const result = await txWithRetry(async (conn) => {
    // Lock the drawer so two taps can't both spend the same credit.
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    if ((await creditsOf(conn, req.user.id, round.id)) < 1) {
      throw new HttpError(409, '你目前沒有抽取資格，先投入一顆扭蛋吧');
    }
    // Normal pool first; special capsules only as fallback (decision 8).
    const capsuleId = (await claimRandom(conn, round.id, req.user.id, false))
      ?? (await claimRandom(conn, round.id, req.user.id, true));
    if (!capsuleId) return null;
    const [d] = await conn.query('INSERT INTO draws (round_id, capsule_id, drawer_id) VALUES (?, ?, ?)', [round.id, capsuleId, req.user.id]);
    const [[capsule]] = await conn.query('SELECT * FROM capsules WHERE id = ?', [capsuleId]);
    return { drawId: d.insertId, capsule };
  });

  if (!result) {
    // Credit is untouched (decision 4).
    return res.status(409).json({ error: '目前池子裡還沒有可以抽的扭蛋，等等再來轉', code: 'EMPTY' });
  }

  const { capsule } = result;
  const provider = capsule.user_id
    ? await pool.query('SELECT * FROM users WHERE id = ?', [capsule.user_id]).then(([[u]]) => u)
    : null;

  if (provider) notifyProvider({ req, activity, capsule, provider, drawer: req.user });

  res.json({
    draw_id: result.drawId,
    capsule: {
      id: capsule.id, title: capsule.title, category: capsule.category, duration: capsule.duration,
      description: capsule.description, conditions: capsule.conditions, is_special: Boolean(capsule.is_special),
    },
    provider: provider ? contactOf(provider) : organizerContact(activity),
    credits: await creditsOf(pool, req.user.id, round.id),
  });
});

// Fire-and-forget: a mail failure must not undo a successful draw.
function notifyProvider({ req, activity, capsule, provider, drawer }) {
  const link = `${req.protocol}://${req.get('host')}/activity?id=${activity.slug}`;
  const lines = [
    `${provider.nickname} 你好：`,
    '',
    `你在「${activity.name}」投入的文化扭蛋被抽到了！`,
    '',
    `扭蛋：${capsule.title}（${CATEGORY_LABEL[capsule.category]}・${DURATION_LABEL[capsule.duration]}）`,
    '',
    `抽到的蛋友：${drawer.nickname}（${drawer.region}）`,
    drawer.bio && `自我介紹：${drawer.bio}`,
    drawer.line_id && `LINE ID：${drawer.line_id}`,
    drawer.instagram && `Instagram：${drawer.instagram}`,
    drawer.phone && `電話：${drawer.phone}`,
    drawer.show_email && `Email：${drawer.email}`,
    '',
    '對方也看得到你的聯絡方式。誰先打聲招呼都可以，一起討論怎麼交換吧。',
    '交換的前提只有：自主、知情、雙方同意。',
    '',
    `查看你的扭蛋：${link}`,
  ].filter((l) => typeof l === 'string'); // drops the optional lines that evaluated to null/0
  sendMail({
    to: provider.email,
    subject: `你的文化扭蛋「${capsule.title}」被抽到了！`,
    text: lines.join('\n'),
  }).catch((err) => console.error('notifyProvider failed:', err.message));
}
