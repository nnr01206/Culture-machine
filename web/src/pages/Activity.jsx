import { useEffect, useState } from 'react';
import { useBalloon } from '../balloon.jsx';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, CATEGORIES, fmtTime, fmtRange } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Brand, Footer, HowItWorks, Loading, MyRecords } from '../components.jsx';
import { CategoryIcon } from '../icons.jsx';
import { rememberPoint } from '../recent.js';

// Landing page behind each activity's QR code, and the participant's home within the activity.
export default function Activity() {
  const [params] = useSearchParams();
  const slug = params.get('id');
  const here = `/activity?id=${encodeURIComponent(slug || '')}`;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pub, setPub] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) { setError('網址缺少活動代碼，請重新掃描 QR Code'); return; }
    api(`/activities/${encodeURIComponent(slug)}`)
      .then((data) => { setPub(data); rememberPoint(data.activity.slug, data.activity.name); })
      .catch((e) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (!slug || !user || user.isAdmin) return;
    if (!user.profile) { navigate(`/profile?next=${encodeURIComponent(here)}`, { replace: true }); return; }
    api(`/activities/${encodeURIComponent(slug)}/me`).then(setMe).catch((e) => setError(e.message));
  }, [slug, user, here, navigate]);

  if (error) return <main className="page"><Brand /><div className="card"><p className="error">{error}</p></div></main>;
  if (!pub || user === undefined) return <Loading />;

  const { activity, round, nextRound, pool } = pub;

  return (
    <main className="page">
      <Brand subtitle={activity.name} />

      {round ? <PoolCard round={round} pool={pool} /> : (
        <div className="card center">
          {nextRound ? (
            <>
              <p style={{ margin: 0 }}>下一場活動</p>
              <p className="next-event"><b>{nextRound.name}</b></p>
              <p className="muted" style={{ margin: 0 }}>{fmtRange(nextRound.starts_at, nextRound.ends_at)}</p>
            </>
          ) : <p style={{ margin: 0 }}>目前沒有進行中的活動，下次活動見！</p>}
        </div>
      )}

      {user === null && (
        <>
          <section className="card-soft">
            <p style={{ marginTop: 0 }}>每個人帶一點自己有的東西來，也帶走另一個人願意分享的東西。</p>
            <HowItWorks />
          </section>
          {round && <Link className="btn btn-block btn-big" to={`/login?next=${encodeURIComponent(here)}`}>開始參加</Link>}
          <p className="muted center">用 Email 收驗證碼登入，不用設定密碼。</p>
        </>
      )}

      {user?.isAdmin && (
        <div className="card-soft"><p className="muted" style={{ margin: 0 }}>你用管理者帳號登入，管理者不參與抽蛋。<Link to="/admin">回後台</Link></p></div>
      )}

      {user && !user.isAdmin && !me && <p className="muted">載入中…</p>}
      {me && <ParticipantHome slug={slug} round={round} me={me} />}
      <Footer />
    </main>
  );
}

function PoolCard({ round, pool }) {
  return (
    <section className="card pool-card">
      <p style={{ margin: 0 }}><b>{round.name}</b></p>
      <p className="muted small" style={{ margin: '2px 0 0' }}>進行到 {fmtTime(round.ends_at)}</p>
      <p className="pool-total">池子裡有 <b>{pool.total}</b> 顆扭蛋</p>
      <div className="pool-cats">
        {CATEGORIES.filter((c) => pool.byCategory[c.key] > 0).map((c) => (
          <span key={c.key} className="pool-cat"><CategoryIcon category={c.key} size={16} />{c.label} {pool.byCategory[c.key]}</span>
        ))}
      </div>
    </section>
  );
}

const IDLE_MS = 20000;
const ENDING_MS = 60 * 60e3;

function ParticipantHome({ slug, round, me }) {
  const q = `?id=${encodeURIComponent(slug)}`;
  const { say } = useBalloon();
  const location = useLocation();
  const credits = round ? me.credits : 0;

  // Balloon lines for this page; the balloon's own rules decide whether they're actually said.
  useEffect(() => {
    if (location.state?.justDropped) say('dropped', '放進去囉！去轉一顆吧');
    if (credits > 0 && new Date(round.ends_at) - Date.now() < ENDING_MS) say('ending', '活動快結束了，別忘了轉');
  }, [location.state, credits, round, say]);

  useEffect(() => {
    if (credits <= 0) return;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => say('idle', `你還有 ${credits} 次可以轉喔`), IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [credits, say]);
  const hasCapsules = me.myCapsules.length > 0;
  return (
    <>

      {round && (
        <section className="card action-card">
          <p className="credits">你有 <b>{me.credits}</b> 次抽取資格</p>
          {!hasCapsules && <p className="muted">先投入一顆你的文化扭蛋，就能轉一次扭蛋機。</p>}
          <div className="action-buttons">
            <Link className="btn btn-big btn-ghost" to={`/activity/drop${q}`}>投入一顆扭蛋</Link>
            {me.credits > 0
              ? <Link className="btn btn-big" to={`/activity/draw${q}`}>轉動扭蛋機</Link>
              : <button className="btn btn-big" disabled>轉動扭蛋機</button>}
          </div>
        </section>
      )}

      {!hasCapsules && me.myDraws.length === 0 && (
        <section className="card-soft"><HowItWorks /></section>
      )}

      <MyRecords draws={me.myDraws} capsules={me.myCapsules} />
    </>
  );
}
