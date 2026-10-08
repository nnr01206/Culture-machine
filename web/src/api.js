export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, code: data?.code });
  return data;
}

export const CATEGORIES = [
  { key: 'skill', label: '技能' },
  { key: 'time', label: '時間' },
  { key: 'space', label: '空間' },
  { key: 'knowledge', label: '知識' },
  { key: 'object', label: '物件' },
  { key: 'companion', label: '陪伴' },
  { key: 'experience', label: '經驗' },
  { key: 'connection', label: '連結' },
  { key: 'creativity', label: '創意' },
];
export const categoryLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label || k;

export const DURATIONS = [
  { key: '30m', label: '30 分鐘' },
  { key: '1h', label: '1 小時' },
  { key: '2h', label: '2 小時' },
  { key: '3h', label: '3 小時' },
  { key: 'half_day', label: '半天（約 4–5 小時）' },
  { key: 'none', label: '不需要特定時間' },
];
export const durationLabel = (k) => DURATIONS.find((d) => d.key === k)?.label || k;

export const CAPSULE_STATUS = { open: '可抽取', drawn: '已抽取', removed: '已下架' };

export const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '');

// Only allow same-site relative redirects (blocks ?next=https://evil.example).
export const safeNext = (next, fallback = '/') => (next && next.startsWith('/') && !next.startsWith('//') ? next : fallback);
