import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Brand, CapsuleCard, Loading } from '../components.jsx';
import { CategoryIcon } from '../icons.jsx';

const SPIN_MS = 1500;
const DROP_MS = 1000;
const OPEN_MS = 650;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch {} };

// Gacha screen (decision 18): turn → knob spins, globe shakes → capsule drops and rolls out →
// tap to crack it open → reveal card. No sound (decision 18).
export default function Draw() {
  const [params] = useSearchParams();
  const slug = params.get('id') || '';
  const back = `/activity?id=${encodeURIComponent(slug)}`;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [phase, setPhase] = useState('idle'); // idle | spinning | dropping | ready | opening | revealed
  const [credits, setCredits] = useState(null);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user === null) { navigate(`/login?next=${encodeURIComponent(`/activity/draw?id=${slug}`)}`, { replace: true }); return; }
    if (!user || user.isAdmin) return;
    if (!user.profile) { navigate(back, { replace: true }); return; }
    api(`/activities/${encodeURIComponent(slug)}/me`)
      .then((me) => {
        if (!me.round) setMessage('本輪已結束，不能再抽了。');
        setCredits(me.round ? me.credits : 0);
      })
      .catch((e) => setMessage(e.message));
  }, [user, slug, back, navigate]);

  if (!user || (credits === null && !message)) return <Loading />;
  if (user.isAdmin) return <main className="page"><Brand /><p className="error">管理者帳號不參與抽蛋。</p></main>;

  const spin = async () => {
    if (phase !== 'idle' || !credits) return;
    setMessage('');
    setResult(null);
    setPhase('spinning');
    buzz([20, 60, 20, 60, 20]);
    const request = api(`/activities/${encodeURIComponent(slug)}/draw`, { method: 'POST' })
      .then((r) => ({ ok: true, r }), (err) => ({ ok: false, err }));
    const [outcome] = await Promise.all([request, sleep(SPIN_MS)]);
    if (!outcome.ok) {
      setPhase('idle');
      setMessage(outcome.err.message);
      if (outcome.err.code !== 'EMPTY') setCredits(0); // e.g. no credits / round ended
      return;
    }
    setResult(outcome.r);
    setCredits(outcome.r.credits);
    setPhase('dropping');
    await sleep(DROP_MS);
    buzz(40);
    setPhase('ready');
  };

  const open = async () => {
    if (phase !== 'ready') return;
    setPhase('opening');
    buzz([30, 30, 80]);
    await sleep(OPEN_MS);
    setPhase('revealed');
  };

  const again = () => { setResult(null); setPhase('idle'); window.scrollTo(0, 0); };
  const busy = phase === 'spinning' || phase === 'dropping';

  return (
    <main className="page">
      <Brand subtitle="轉動扭蛋機" />

      {phase !== 'revealed' && (
        <div className={`gacha-stage phase-${phase}`}>
          <Machine />
          {(phase === 'dropping' || phase === 'ready' || phase === 'opening') && (
            <button className="prize" onClick={open} disabled={phase !== 'ready'} aria-label="打開扭蛋">
              <span className="prize-top" />
              <span className="prize-bottom" />
            </button>
          )}
        </div>
      )}

      {phase === 'idle' && (
        <div className="center">
          <p className="credits">你有 <b>{credits}</b> 次抽取資格</p>
          {message && <p className="notice">{message}</p>}
          {credits > 0
            ? <button className="btn btn-big btn-block" onClick={spin}>轉動扭蛋機</button>
            : (
              <>
                {!message && <p className="muted">先投入一顆扭蛋，才能轉一次。</p>}
                <Link className="btn btn-big btn-block" to={`/activity/drop?id=${encodeURIComponent(slug)}`}>投入一顆扭蛋</Link>
              </>
            )}
          <Link className="btn btn-block btn-ghost" to={back}>回活動頁</Link>
        </div>
      )}
      {busy && <p className="center muted">扭蛋機轉動中…</p>}
      {phase === 'ready' && <p className="center tap-hint">點一下扭蛋，打開它！</p>}

      {phase === 'revealed' && result && (
        <div className="reveal">
          <p className="reveal-head">
            <CategoryIcon category={result.capsule.category} size={28} />
            你抽到了 <b>{result.provider.nickname}</b> 的扭蛋！
          </p>
          <CapsuleCard capsule={result.capsule} provider={result.provider} />
          <div className="card-soft next-steps">
            <h3>接下來</h3>
            <ol>
              <li>用上面的聯絡方式跟蛋友打聲招呼，對方也收到通知、看得到你的聯絡方式。</li>
              <li>一起討論交換的時間和方式。不需要等價，也不用算值多少錢。</li>
              <li>交換的前提只有：自主、知情、雙方同意。</li>
            </ol>
            <p className="muted small">這顆扭蛋會一直保存在活動頁的「我抽到的扭蛋」裡。</p>
          </div>
          {credits > 0 && <button className="btn btn-big btn-block" onClick={again}>再轉一次（還有 {credits} 次）</button>}
          <Link className="btn btn-block btn-ghost" to={back}>回活動頁</Link>
        </div>
      )}
    </main>
  );
}

const GLOBE_CAPSULES = [
  [70, 70, -30], [112, 58, 20], [135, 100, -60], [92, 108, 45], [58, 118, 10], [120, 135, -15], [82, 145, 70],
];

function Machine() {
  return (
    <svg className="machine" viewBox="0 0 200 290" aria-hidden="true">
      <g className="globe">
        <rect x="72" y="8" width="56" height="16" rx="6" fill="var(--orange)" />
        <circle cx="100" cy="102" r="78" fill="#fff" stroke="var(--orange)" strokeWidth="5" />
        {GLOBE_CAPSULES.map(([x, y, r], i) => (
          // Position lives on the outer <g>; the CSS jiggle animates the inner one so it can't clobber it.
          <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
            <g className="globe-capsule" style={{ '--i': i }}>
              <path d="M-17 0a17 17 0 0 0 34 0z" fill="var(--orange)" />
              <circle r="17" fill="none" stroke="var(--orange)" strokeWidth="3" />
            </g>
          </g>
        ))}
        <path d="M52 48a68 68 0 0 1 30-22" fill="none" stroke="var(--orange-tint)" strokeWidth="6" strokeLinecap="round" />
      </g>
      <rect x="58" y="176" width="84" height="14" rx="4" fill="var(--orange)" />
      <path d="M54 190h92l16 92H38z" fill="var(--orange)" />
      <g className="knob" style={{ transformOrigin: '100px 222px' }}>
        <circle cx="100" cy="222" r="19" fill="#fff" />
        <rect x="96" y="207" width="8" height="30" rx="4" fill="var(--orange)" />
      </g>
      <rect x="80" y="252" width="40" height="22" rx="5" fill="var(--orange-dark)" />
    </svg>
  );
}
