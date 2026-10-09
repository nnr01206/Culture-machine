import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, fmtRange, ROUND_STATUS } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Brand, Footer, HowItWorks, Loading, MyRecords } from '../components.jsx';
import { recentPoints, forgetPoint } from '../recent.js';

// Logged-in participants see the events they took part in; everyone else sees the intro.
// No admin link here: admins go to /admin directly.
export default function Home() {
  const { user } = useAuth();
  if (user === undefined) return <Loading />;

  const participant = user && !user.isAdmin;
  return (
    <main className="page">
      <Brand />
      <RecentPoints />
      {participant && user.profile ? <MyEvents /> : <Intro user={user} />}
      <Footer />
    </main>
  );
}

function Intro({ user }) {
  return (
    <>
      <div className="card">
        <p style={{ marginTop: 0 }}>每個人帶一點自己有的東西來，也帶走另一個人願意分享的東西。</p>
        <HowItWorks />
      </div>
      <p className="center"><b>到活動現場，掃描 QR Code 就能開始。</b></p>
      {user === null && (
        <p className="center small">參加過了？<Link to="/login">登入看你的扭蛋</Link></p>
      )}
      {user && !user.isAdmin && !user.profile && (
        <Link className="btn btn-block" to="/profile?next=%2F">先填基本資料</Link>
      )}
    </>
  );
}

function MyEvents() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/me/events').then((r) => setEvents(r.events)).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!events) return <p className="muted">載入中…</p>;
  if (!events.length) {
    return (
      <div className="card center">
        <p style={{ marginTop: 0 }}>你還沒有參加過活動。</p>
        <p className="muted" style={{ marginBottom: 0 }}>到活動現場掃描 QR Code，投入第一顆文化扭蛋吧！</p>
      </div>
    );
  }

  return (
    <>
      <h2>我參加的活動</h2>
      {events.map((e, i) => <EventItem key={e.id} event={e} defaultOpen={i === 0 || e.status === 'ongoing'} />)}
    </>
  );
}

function EventItem({ event, defaultOpen }) {
  const drew = event.myDraws.length;
  const gave = event.myCapsules.length;
  return (
    <details className="my-event" open={defaultOpen}>
      <summary>
        <span className="my-event-head">
          <b>{event.name}</b>
          <span className={`tag status-${event.status}`}>{ROUND_STATUS[event.status]}</span>
        </span>
        <span className="muted small">{event.point_name}・{fmtRange(event.starts_at, event.ends_at)}</span>
        <span className="small">投入 {gave} 顆・抽到 {drew} 顆</span>
      </summary>
      <div className="my-event-body">
        {event.status === 'ongoing' && (
          <div className="my-event-cta">
            <span>還有 <b>{event.credits}</b> 次抽取資格</span>
            <Link className="btn btn-sm" to={`/activity?id=${encodeURIComponent(event.point_slug)}`}>進入活動</Link>
          </div>
        )}
        <MyRecords draws={event.myDraws} capsules={event.myCapsules} headingLevel="h3" showRound={false} />
      </div>
    </details>
  );
}

// Quick way back into QR points opened in this browser, without scanning again. Shown to everyone.
function RecentPoints() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    const list = recentPoints();
    if (!list.length) { setItems([]); return; }
    Promise.allSettled(list.map((p) => api(`/activities/${encodeURIComponent(p.slug)}`))).then((results) => {
      setItems(results.flatMap((r, i) => {
        if (r.status === 'fulfilled') return [r.value];
        if (r.reason?.status === 404) forgetPoint(list[i].slug); // the point no longer exists
        return [];
      }));
    });
  }, []);

  if (!items?.length) return null;
  return (
    <section className="recent">
      <h2>最近去過的活動</h2>
      {items.map(({ activity, round, nextRound }) => (
        <Link key={activity.slug} to={`/activity?id=${encodeURIComponent(activity.slug)}`} className="recent-row">
          <span className="recent-info">
            <b>{activity.name}</b>
            <span className="muted small">
              {round ? <>進行中：{round.name}</> : nextRound ? <>下一場：{nextRound.name}・{fmtRange(nextRound.starts_at, nextRound.ends_at)}</> : '目前沒有活動'}
            </span>
          </span>
          <span className={`btn btn-sm ${round ? '' : 'btn-ghost'}`}>{round ? '進入' : '查看'}</span>
        </Link>
      ))}
    </section>
  );
}
