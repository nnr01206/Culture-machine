import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from './auth.jsx';

// The profile balloon (top-right on participant pages) links to profile editing and occasionally says
// one short line. Pages call say(id, text) when something happened; the rules below decide whether it
// actually speaks, so it stays helpful instead of chatty. Tune the numbers here.
const RULES = {
  showMs: 4000,          // how long a line stays up
  cooldownMs: 3 * 60e3,  // minimum gap between two unprompted lines (see UNPROMPTED)
  maxPerLine: 2,         // the same line is heard at most this many times per person
  greetTimes: 3,         // the greeting shows on the first N page views
  collectMs: 600,        // wait this long for competing triggers, then say only the most important
};

// Higher wins when several triggers fire together.
const PRIORITY = { ending: 5, dropped: 4, drawn: 4, empty: 3, idle: 2, greet: 1 };

// Lines the balloon starts on its own are rate-limited by the cooldown. Replies to something the user
// just did (dropped, drawn, empty) are not, or a first-timer would never hear "say hi to your match"
// right after the "it's in!" line. The greeting also doesn't use up the page's one line.
const UNPROMPTED = new Set(['idle', 'ending']);

const HIDDEN_ON = ['/admin', '/login', '/profile'];
const STORE_KEY = 'cm_balloon';

// Per-viewer memory (counts, last spoken time). Lives only in this browser; if storage is blocked
// the balloon just forgets, which is harmless.
function loadMemory() {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { counts: m.counts || {}, lastAt: m.lastAt || 0 };
  } catch {
    return { counts: {}, lastAt: 0 };
  }
}
function saveMemory(m) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch {}
}

const isTyping = () => {
  const el = document.activeElement;
  return Boolean(el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type))));
};

const BalloonContext = createContext({ say: () => {}, setBusy: () => {} });
export const useBalloon = () => useContext(BalloonContext);

export function BalloonProvider({ children }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const visible = Boolean(user && !user.isAdmin && user.profile)
    && !HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const [line, setLine] = useState(null); // { id, text } currently shown
  const visibleRef = useRef(visible);
  const busyRef = useRef(false);
  const spokeThisPage = useRef(false);
  const candidates = useRef([]);
  const flushTimer = useRef(null);
  const hideTimer = useRef(null);
  visibleRef.current = visible;

  const dismiss = useCallback(() => {
    clearTimeout(hideTimer.current);
    setLine(null);
  }, []);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const pick = candidates.current.sort((a, b) => (PRIORITY[b.id] || 0) - (PRIORITY[a.id] || 0))[0];
    candidates.current = [];
    if (!pick || !visibleRef.current || busyRef.current || isTyping() || spokeThisPage.current) return;
    if (pick.id !== 'greet') spokeThisPage.current = true;
    const mem = loadMemory();
    mem.counts[pick.id] = (mem.counts[pick.id] || 0) + 1;
    if (UNPROMPTED.has(pick.id)) mem.lastAt = Date.now();
    saveMemory(mem);
    setLine(pick);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setLine(null), RULES.showMs);
  }, []);

  const say = useCallback((id, text) => {
    if (!visibleRef.current || spokeThisPage.current || busyRef.current || isTyping()) return;
    const mem = loadMemory();
    const limit = id === 'greet' ? RULES.greetTimes : RULES.maxPerLine;
    if ((mem.counts[id] || 0) >= limit) return;
    if (UNPROMPTED.has(id) && Date.now() - mem.lastAt < RULES.cooldownMs) return;
    candidates.current.push({ id, text });
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, RULES.collectMs);
  }, [flush]);

  // Pages mark animations (e.g. the gacha spin) as busy so the balloon stays quiet.
  const setBusy = useCallback((busy) => {
    busyRef.current = busy;
    if (busy) dismiss();
  }, [dismiss]);

  // New page view: allow one line again, drop anything pending or showing.
  useEffect(() => {
    spokeThisPage.current = false;
    candidates.current = [];
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    dismiss();
  }, [pathname, search, dismiss]);

  // First few page views: say hi (lowest priority, so any real trigger on the same page wins).
  const nickname = user?.profile?.nickname;
  useEffect(() => {
    if (visible) say('greet', null);
  }, [visible, pathname, search, say]);

  const api = useMemo(() => ({ say, setBusy }), [say, setBusy]);
  return (
    <BalloonContext.Provider value={api}>
      {children}
      {visible && <Balloon key={pathname + search} nickname={nickname} line={line} onDismiss={dismiss} profileTo={`/profile?next=${encodeURIComponent(pathname + search)}`} />}
    </BalloonContext.Provider>
  );
}

// Keyed by path in the provider, so the menu closes whenever the page changes.
function Balloon({ nickname, line, onDismiss, profileTo }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const isGreeting = !line || line.id === 'greet';

  const toggle = () => { onDismiss(); setOpen((o) => !o); };
  // The greeting invites you to open the menu; any other line is just dismissed on tap.
  const onBubble = () => (isGreeting ? toggle() : onDismiss());

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const doLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <div ref={rootRef} className={`balloon ${line && !open ? 'speaking' : ''} ${open ? 'menu-open' : ''}`}>
      <button type="button" className="balloon-bubble" onClick={onBubble} tabIndex={line ? 0 : -1}>
        {isGreeting
          ? <><b>嗨，{nickname}！</b><span>點我打開選單</span></>
          : <b className="balloon-line">{line.text}</b>}
      </button>
      <button type="button" className="balloon-figure" onClick={toggle}
        aria-haspopup="menu" aria-expanded={open} aria-label={`嗨，${nickname}！打開選單`}>
        {/* Hot-air balloon: orange envelope with white seams and a cute face, ropes, basket. */}
        <svg className="balloon-svg" width="40" height="61" viewBox="0 0 46 70" aria-hidden="true">
          <path d="M23 2C10 2 3 12 3 23c0 10 8 17 12 23h16c4-6 12-13 12-23C43 12 36 2 23 2z" fill="var(--orange)" />
          <path d="M23 2.5c-7 6-10 15-10 23 0 8 2 14 4 20.5M23 2.5c7 6 10 15 10 23 0 8-2 14-4 20.5" fill="none" stroke="#fff" strokeWidth="1.4" opacity=".55" />
          <ellipse cx="12" cy="13" rx="2.6" ry="5" fill="#fff" opacity=".4" transform="rotate(25 12 13)" />
          <circle cx="18" cy="22" r="2" fill="#fff" />
          <circle cx="28" cy="22" r="2" fill="#fff" />
          <path d="M19.5 28q3.5 3.2 7 0" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="14" cy="27" r="2.2" fill="#f4a582" opacity=".75" />
          <circle cx="32" cy="27" r="2.2" fill="#f4a582" opacity=".75" />
          <rect x="14.5" y="45" width="17" height="4" rx="1.5" fill="var(--orange-dark)" />
          <path d="M16.5 49l2.5 8M29.5 49l-2.5 8" stroke="var(--orange-dark)" strokeWidth="1.3" strokeLinecap="round" />
          <rect x="16.5" y="57" width="13" height="10" rx="2.5" fill="var(--orange-dark)" />
          <path d="M16.5 61.5h13M21 57v10M25 57v10" stroke="#fff" strokeWidth=".9" opacity=".35" />
        </svg>
        <span className="balloon-badge" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="balloon-menu" role="menu">
          <Link role="menuitem" to="/" onClick={() => setOpen(false)}><MenuIcon d="M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5" />回首頁</Link>
          <Link role="menuitem" to={profileTo} onClick={() => setOpen(false)}><MenuIcon d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" />編輯個人資料</Link>
          <button type="button" role="menuitem" onClick={doLogout}><MenuIcon d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />登出</button>
        </div>
      )}
      {line && <span className="visually-hidden" role="status">{isGreeting ? `嗨，${nickname}！` : line.text}</span>}
    </div>
  );
}

const MenuIcon = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
