import { Router } from 'express';
import { pool } from './db.js';
import { CATEGORIES } from './config.js';
import { currentRound, nextRound } from './rounds.js';

export const publicRouter = Router();

const roundInfo = (r) => r && { id: r.id, name: r.name, starts_at: r.starts_at, ends_at: r.ends_at };

// What anyone scanning a QR point's code sees: the point, its live/next event, pool size by category.
// Never returns capsule contents or providers (decision 10).
publicRouter.get('/activities/:slug', async (req, res) => {
  const [[activity]] = await pool.query('SELECT id, slug, name FROM activities WHERE slug = ?', [req.params.slug]);
  if (!activity) return res.status(404).json({ error: '找不到這個 QR Code 對應的地點' });
  const round = await currentRound(activity.id);
  const upcoming = round ? null : await nextRound(activity.id);
  let poolInfo = null;
  if (round) {
    const [rows] = await pool.query(
      `SELECT category, COUNT(*) AS count FROM capsules
       WHERE round_id = ? AND status = 'open' AND is_special = FALSE
       GROUP BY category`,
      [round.id],
    );
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, Number(rows.find((r) => r.category === c)?.count || 0)]));
    poolInfo = { total: Object.values(byCategory).reduce((a, b) => a + b, 0), byCategory };
  }
  res.json({
    activity: { slug: activity.slug, name: activity.name },
    round: roundInfo(round),
    nextRound: roundInfo(upcoming),
    pool: poolInfo,
  });
});
