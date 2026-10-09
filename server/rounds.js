// In the UI an `activities` row is a QR 點位 (fixed QR code, e.g. the bookstore) and a `rounds`
// row is an 活動 (one event with its own start/end). An event is live while starts_at <= now < ends_at;
// events at the same QR point never overlap, so a QR code always leads to at most one live event.
import { pool } from './db.js';
import { HttpError } from './errors.js';

export function roundStatus(round, now = Date.now()) {
  if (new Date(round.starts_at).getTime() > now) return 'upcoming';
  if (new Date(round.ends_at).getTime() <= now) return 'ended';
  return 'ongoing';
}

export const withStatus = (round) => ({ ...round, status: roundStatus(round) });

export async function currentRound(activityId, conn = pool) {
  const [[round]] = await conn.query(
    `SELECT * FROM rounds
     WHERE activity_id = ? AND starts_at <= UTC_TIMESTAMP() AND ends_at > UTC_TIMESTAMP()
     ORDER BY starts_at LIMIT 1`,
    [activityId],
  );
  return round || null;
}

export async function nextRound(activityId, conn = pool) {
  const [[round]] = await conn.query(
    'SELECT * FROM rounds WHERE activity_id = ? AND starts_at > UTC_TIMESTAMP() ORDER BY starts_at LIMIT 1',
    [activityId],
  );
  return round || null;
}

export function parseTime(value, label) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new HttpError(400, `請填${label}`);
  return d;
}

export function parseRange(body, { startLabel = '開始時間', endLabel = '結束時間' } = {}) {
  const startsAt = parseTime(body?.starts_at, startLabel);
  const endsAt = parseTime(body?.ends_at, endLabel);
  if (endsAt <= startsAt) throw new HttpError(400, '結束時間要晚於開始時間');
  return { startsAt, endsAt };
}

const fmt = (d) => new Date(d).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Call inside a transaction that has locked the QR point (activities row).
export async function assertNoOverlap(conn, activityId, startsAt, endsAt, excludeRoundId = 0) {
  const [[clash]] = await conn.query(
    'SELECT name, starts_at, ends_at FROM rounds WHERE activity_id = ? AND id <> ? AND starts_at < ? AND ends_at > ? LIMIT 1',
    [activityId, excludeRoundId, endsAt, startsAt],
  );
  if (clash) throw new HttpError(409, `同一個 QR 點位的活動時間不能重疊：跟「${clash.name}」（${fmt(clash.starts_at)} – ${fmt(clash.ends_at)}）重疊了`);
}
