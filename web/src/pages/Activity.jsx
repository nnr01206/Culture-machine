import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, CATEGORIES, CAPSULE_STATUS, fmtTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Brand, CapsuleCard, ContactBlock, Footer, HowItWorks, Loading } from '../components.jsx';
import { CategoryIcon } from '../icons.jsx';

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
    api(`/activities/${encodeURIComponent(slug)}`).then(setPub).catch((e) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    if (!slug || !user || user.isAdmin) return;
    if (!user.profile) { navigate(`/profile?next=${encodeURIComponent(here)}`, { replace: true }); return; }
    api(`/activities/${encodeURIComponent(slug)}/me`).then(setMe).catch((e) => setError(e.message));
  }, [slug, user, here, navigate]);

  if (error) return <main className="page"><Brand /><div className="card"><p className="error">{error}</p></div></main>;
  if (!pub || user === undefined) return <Loading />;

  const { activity, round, pool } = pub;

  return (
    <main className="page">
      <Brand subtitle={activity.name} />

      {round ? <PoolCard round={round} pool={pool} /> : (
        <div className="card"><p style={{ margin: 0 }}><b>本輪已結束</b>，下一輪即將開始。</p></div>
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
      <p className="muted" style={{ margin: 0 }}>{round.name}・進行中</p>
      <p className="pool-total">池子裡有 <b>{pool.total}</b> 顆扭蛋</p>
      <div className="pool-cats">
        {CATEGORIES.filter((c) => pool.byCategory[c.key] > 0).map((c) => (
          <span key={c.key} className="pool-cat"><CategoryIcon category={c.key} size={16} />{c.label} {pool.byCategory[c.key]}</span>
        ))}
      </div>
    </section>
  );
}

function ParticipantHome({ slug, round, me }) {
  const q = `?id=${encodeURIComponent(slug)}`;
  const hasCapsules = me.myCapsules.length > 0;
  return (
    <>
      <p className="hello">嗨，{me.profile.nickname}！ <Link to={`/profile?next=${encodeURIComponent(`/activity${q}`)}`} className="small-link">編輯資料</Link></p>

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

      {me.myDraws.length > 0 && (
        <section>
          <h2>我抽到的扭蛋</h2>
          <p className="muted">聯絡蛋友，一起討論怎麼交換。前提只有：自主、知情、雙方同意。</p>
          {me.myDraws.map((d) => (
            <CapsuleCard key={d.draw_id} capsule={d.capsule} provider={d.provider}>
              <p className="muted small">{d.round_name}・{fmtTime(d.drawn_at)} 抽到</p>
            </CapsuleCard>
          ))}
        </section>
      )}

      {hasCapsules && (
        <section>
          <h2>我投入的扭蛋</h2>
          {me.myCapsules.map((c) => (
            <CapsuleCard key={c.id} capsule={c}>
              <p className="small">
                <span className={`tag ${c.status === 'drawn' ? 'tag-solid' : c.status === 'removed' ? 'tag-muted' : ''}`}>{CAPSULE_STATUS[c.status]}</span>
                <span className="muted">　{c.round_name}</span>
              </p>
              {c.drawnBy.map((p, i) => <ContactBlock key={i} person={p} label="抽到的蛋友" />)}
              {c.status === 'removed' && <p className="muted small">這顆扭蛋已被主辦方下架，有疑問請聯絡主辦方。</p>}
            </CapsuleCard>
          ))}
        </section>
      )}
    </>
  );
}
