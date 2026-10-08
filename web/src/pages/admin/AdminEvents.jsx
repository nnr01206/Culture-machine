import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, fmtRange, fromLocalInput, ROUND_STATUS } from '../../api.js';

const NEW_POINT = '__new__';
const SECTIONS = [['ongoing', '進行中'], ['upcoming', '即將開始'], ['ended', '已結束']];

export default function AdminEvents() {
  const [events, setEvents] = useState(null);
  const [points, setPoints] = useState([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = () => Promise.all([api('/admin/rounds'), api('/admin/activities')])
    .then(([e, p]) => { setEvents(e); setPoints(p); })
    .catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  if (error) return <p className="error">{error}</p>;
  if (!events) return <p className="muted">載入中…</p>;

  return (
    <>
      <div className="row page-head">
        <h2>活動</h2>
        <span className="spacer" />
        {!creating && <button className="btn" onClick={() => setCreating(true)}>＋ 新增活動</button>}
      </div>

      {creating && <NewEventForm points={points} onCancel={() => setCreating(false)} />}

      {events.length === 0 && !creating && <p className="muted">還沒有活動。按「新增活動」建立第一個。</p>}

      {SECTIONS.map(([status, title]) => {
        const list = events.filter((e) => e.status === status);
        if (!list.length) return null;
        return (
          <section key={status}>
            <h3 className="section-title">{title}</h3>
            <ul className="event-list">
              {list.map((e) => (
                <li key={e.id}>
                  <Link to={`/admin/events/${e.id}`} className="event-row">
                    <span className="event-name">{e.name}</span>
                    <span className="event-meta">{e.point_name}・{fmtRange(e.starts_at, e.ends_at)}</span>
                    <span className="event-side">
                      <span className="muted small">{e.capsule_count} 顆蛋</span>
                      <span className={`tag status-${e.status}`}>{ROUND_STATUS[e.status]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function NewEventForm({ points, onCancel }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    activity_id: points[0]?.id ? String(points[0].id) : NEW_POINT,
    name: '', starts_at: '', ends_at: '',
    point: { name: '', organizer_name: '', organizer_contact: '' },
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isNewPoint = form.activity_id === NEW_POINT;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setPoint = (k) => (e) => setForm({ ...form, point: { ...form.point, [k]: e.target.value } });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = {
        name: form.name,
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
        ...(isNewPoint ? { point: form.point } : { activity_id: Number(form.activity_id) }),
      };
      const { id } = await api('/admin/rounds', { method: 'POST', body });
      navigate(`/admin/events/${id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form className="card new-event" onSubmit={submit}>
      <label htmlFor="ev-name">活動名稱</label>
      <input id="ev-name" required maxLength={100} value={form.name} onChange={set('name')} placeholder="例如：2026 秋季交換派對" />

      <div className="grid-2">
        <div>
          <label htmlFor="ev-start">開始</label>
          <input id="ev-start" type="datetime-local" required value={form.starts_at} onChange={set('starts_at')} />
        </div>
        <div>
          <label htmlFor="ev-end">結束</label>
          <input id="ev-end" type="datetime-local" required min={form.starts_at || undefined} value={form.ends_at} onChange={set('ends_at')} />
        </div>
      </div>

      <label htmlFor="ev-point">QR 點位</label>
      <select id="ev-point" value={form.activity_id} onChange={set('activity_id')}>
        {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={NEW_POINT}>＋ 新的 QR 點位…</option>
      </select>
      <p className="muted small">同一個 QR 點位一直用同一個 QR Code（例如書店專用），每次活動都掛在它底下；同一點位的活動時間不能重疊。新點位的 QR Code 會自動產生。</p>

      {isNewPoint && (
        <fieldset className="subform">
          <legend>新的 QR 點位</legend>
          <label htmlFor="pt-name">點位名稱</label>
          <input id="pt-name" required maxLength={100} value={form.point.name} onChange={setPoint('name')} placeholder="例如：街角書店" />
          <label htmlFor="pt-org">主辦方名稱</label>
          <input id="pt-org" required maxLength={100} value={form.point.organizer_name} onChange={setPoint('organizer_name')} />
          <label htmlFor="pt-contact">主辦方聯絡方式</label>
          <input id="pt-contact" required maxLength={255} value={form.point.organizer_contact} onChange={setPoint('organizer_contact')} placeholder="主辦方的蛋被抽中時顯示，例如 LINE @xxxx" />
        </fieldset>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy}>{busy ? '建立中…' : '建立活動'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>取消</button>
      </div>
    </form>
  );
}
