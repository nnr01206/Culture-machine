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
      {visible && <Balloon nickname={nickname} line={line} onDismiss={dismiss} to={`/profile?next=${encodeURIComponent(pathname + search)}`} />}
    </BalloonContext.Provider>
  );
}

function Balloon({ nickname, line, onDismiss, to }) {
  const navigate = useNavigate();
  const isGreeting = !line || line.id === 'greet';
  // The greeting invites you to edit your profile; any other line is just dismissed on tap.
  const onBubble = () => (isGreeting ? navigate(to) : onDismiss());

  return (
    <div className={`balloon ${line ? 'speaking' : ''}`}>
      <button type="button" className="balloon-bubble" onClick={onBubble} tabIndex={line ? 0 : -1}>
        {isGreeting
          ? <><b>嗨，{nickname}！</b><span>點我編輯資料</span></>
          : <b className="balloon-line">{line.text}</b>}
      </button>
      <Link to={to} className="balloon-figure" aria-label={`嗨，${nickname}！編輯個人資料`}>
        <svg className="balloon-svg" width="40" height="66" viewBox="0 0 46 76" aria-hidden="true">
          <path d="M23 48c-2 6 4 9 0 15s3 9 1 12" fill="none" stroke="var(--orange)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M23 2C11 2 3 11 3 22c0 13 11 24 20 26 9-2 20-13 20-26C43 11 35 2 23 2z" fill="var(--orange)" />
          <path d="M20 48l3 4 3-4z" fill="var(--orange-dark)" />
          <ellipse cx="13" cy="13" rx="3.5" ry="6" fill="#fff" opacity=".45" transform="rotate(25 13 13)" />
          <circle cx="17" cy="23" r="2" fill="#fff" />
          <circle cx="29" cy="23" r="2" fill="#fff" />
          <path d="M18.5 29q4.5 4 9 0" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="13.5" cy="28" r="2.2" fill="#f4a582" opacity=".7" />
          <circle cx="32.5" cy="28" r="2.2" fill="#f4a582" opacity=".7" />
        </svg>
        <span className="balloon-badge" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" />
          </svg>
        </span>
      </Link>
      {line && <span className="visually-hidden" role="status">{isGreeting ? `嗨，${nickname}！` : line.text}</span>}
    </div>
  );
}
