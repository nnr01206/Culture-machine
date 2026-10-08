import { Router } from 'express';
import { pool } from './db.js';
import { CATEGORIES } from './config.js';

export const publicRouter = Router();

// What anyone scanning the QR code sees: activity, current round, pool size by category.
// Never returns capsule contents or providers (decision 10).
publicRouter.get('/activities/:slug', async (req, res) => {
  const [[activity]] = await pool.query('SELECT id, slug, name FROM activities WHERE slug = ?', [req.params.slug]);
  if (!activity) return res.status(404).json({ error: '找不到這個活動' });
  const [[round]] = await pool.query(
    'SELECT id, name, starts_at FROM rounds WHERE activity_id = ? AND is_open = TRUE',
    [activity.id],
  );
  let pool_ = null;
  if (round) {
    const [rows] = await pool.query(
      `SELECT category, COUNT(*) AS count FROM capsules
       WHERE round_id = ? AND status = 'open' AND is_special = FALSE
       GROUP BY category`,
      [round.id],
    );
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, Number(rows.find((r) => r.category === c)?.count || 0)]));
    pool_ = { total: Object.values(byCategory).reduce((a, b) => a + b, 0), byCategory };
  }
  res.json({ activity: { slug: activity.slug, name: activity.name }, round: round || null, pool: pool_ });
});
