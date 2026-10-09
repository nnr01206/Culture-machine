// QR points this browser has opened, so the home page can offer a quick way back without re-scanning.
// A per-viewer convenience only: lives in this browser, may be empty (private mode, cleared data).
const KEY = 'cm_recent_points';
const MAX = 5;

export function recentPoints() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.slug === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberPoint(slug, name) {
  try {
    const rest = recentPoints().filter((p) => p.slug !== slug);
    localStorage.setItem(KEY, JSON.stringify([{ slug, name, at: Date.now() }, ...rest].slice(0, MAX)));
  } catch {}
}

export function forgetPoint(slug) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentPoints().filter((p) => p.slug !== slug)));
  } catch {}
}
