import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import QRCode from 'qrcode';
import { api, fmtRange, fromLocalInput, toLocalInput, ROUND_STATUS } from '../../api.js';
import RoundTabs from './RoundTabs.jsx';

export default function AdminEvent() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api(`/admin/rounds/${id}`).then(setEvent).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!event) return <p className="muted">載入中…</p>;

  return (
    <>
      <p className="small"><Link to="/admin">← 所有活動</Link></p>
      <EventCard event={event} onChanged={load} />
      <RoundTabs key={`${event.id}-${event.status}`} round={event} />
    </>
  );
}

// One card: the QR point's code on the left, event + organizer info on the right, one edit form for both.
// The QR code belongs to the QR point, so every event at that point shares it.
function EventCard({ event, onChanged }) {
  const navigate = useNavigate();
  const url = `${window.location.origin}/activity?id=${event.point_slug}`;
  const [qr, setQr] = useState('');
  const [mode, setMode] = useState('view'); // view | edit | confirm-end | confirm-delete
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    QRCode.toDataURL(url, { width: 1024, margin: 2, color: { dark: '#E05A2B', light: '#FFFFFF' } }).then(setQr);
  }, [url]);

  const run = async (fn) => {
    setError('');
    try { await fn(); } catch (err) { setError(err.message); }
  };
  const startEdit = () => {
    setForm({
      name: event.name,
      starts_at: toLocalInput(event.starts_at),
      ends_at: toLocalInput(event.ends_at),
      point: { name: event.point_name, organizer_name: event.point_organizer_name, organizer_contact: event.point_organizer_contact },
    });
    setError('');
    setMode('edit');
  };
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api(`/admin/rounds/${event.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          ...(event.status === 'upcoming' && { starts_at: fromLocalInput(form.starts_at) }),
          ends_at: fromLocalInput(form.ends_at),
          point: form.point,
        },
      });
      setMode('view');
      onChanged();
    });
  };
  const endNow = () => run(async () => { await api(`/admin/rounds/${event.id}/end`, { method: 'POST' }); setMode('view'); onChanged(); });
  const remove = () => run(async () => { await api(`/admin/rounds/${event.id}`, { method: 'DELETE' }); navigate('/admin'); });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setPoint = (k) => (e) => setForm({ ...form, point: { ...form.point, [k]: e.target.value } });

  return (
    <div className="card event-card">
      <div className="event-card-body">
        <div className="event-card-qr">
          {qr && <img src={qr} alt={`${event.point_name} QR Code`} />}
          {qr && <a className="btn btn-sm" href={qr} download={`culture-machine-${event.point_slug}.png`}>下載 QR Code</a>}
        </div>

        {mode === 'edit' ? (
          <form className="event-card-info" onSubmit={save}>
            <label htmlFor="ed-name">活動名稱</label>
            <input id="ed-name" required maxLength={100} value={form.name} onChange={set('name')} />
            <div className="grid-2">
              <div>
                <label htmlFor="ed-start">開始</label>
                <input id="ed-start" type="datetime-local" required disabled={event.status !== 'upcoming'} value={form.starts_at} onChange={set('starts_at')} />
              </div>
              <div>
                <label htmlFor="ed-end">結束</label>
                <input id="ed-end" type="datetime-local" required value={form.ends_at} onChange={set('ends_at')} />
              </div>
            </div>
            {event.status !== 'upcoming' && <p className="muted small">活動已經開始，只能調整結束時間（延長或縮短）。</p>}

            <fieldset className="subform">
              <legend>QR 點位</legend>
              <p className="muted small" style={{ marginTop: 0 }}>這裡的修改會套用到這個點位底下的所有活動。</p>
              <label htmlFor="ed-pt-name">點位名稱</label>
              <input id="ed-pt-name" required maxLength={100} value={form.point.name} onChange={setPoint('name')} />
              <label htmlFor="ed-pt-org">主辦方名稱</label>
              <input id="ed-pt-org" required maxLength={100} value={form.point.organizer_name} onChange={setPoint('organizer_name')} />
              <label htmlFor="ed-pt-contact">主辦方聯絡方式（主辦方的蛋被抽中時顯示）</label>
              <input id="ed-pt-contact" required maxLength={255} value={form.point.organizer_contact} onChange={setPoint('organizer_contact')} />
            </fieldset>

            {error && <p className="error">{error}</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn">儲存</button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>取消</button>
            </div>
          </form>
        ) : (
          <div className="event-card-info">
            <div className="row">
              <h2 style={{ margin: 0 }}>{event.name}</h2>
              <span className={`tag status-${event.status}`}>{ROUND_STATUS[event.status]}</span>
            </div>
            <p className="event-meta-line">{fmtRange(event.starts_at, event.ends_at)}</p>
            <dl className="event-facts">
              <dt>QR 點位</dt><dd>{event.point_name}</dd>
              <dt>主辦方</dt><dd>{event.point_organizer_name}・{event.point_organizer_contact}</dd>
              <dt>網址</dt><dd><a href={url} target="_blank" rel="noreferrer"><code>{url}</code></a></dd>
            </dl>

            {mode === 'confirm-end' && (
              <div className="confirm">
                <span>結束後就不能再投蛋、抽蛋，確定現在結束？</span>
                <button className="btn btn-sm" onClick={endNow}>確定結束</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMode('view')}>取消</button>
              </div>
            )}
            {mode === 'confirm-delete' && (
              <div className="confirm">
                <span>確定刪除這個活動？</span>
                <button className="btn btn-sm" onClick={remove}>確定刪除</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMode('view')}>取消</button>
              </div>
            )}
            {mode === 'view' && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={startEdit}>{event.status === 'ended' ? '延長／編輯' : '編輯'}</button>
                {event.status === 'ongoing' && <button className="btn btn-ghost btn-sm" onClick={() => setMode('confirm-end')}>提前結束</button>}
                {Number(event.capsule_count) === 0 && <button className="btn btn-ghost btn-sm" onClick={() => setMode('confirm-delete')}>刪除</button>}
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        )}
      </div>
      <p className="muted small event-card-note">
        QR Code 屬於 QR 點位，這個點位的每一場活動都用同一張，印一次就能一直用。QR Code 依目前後台的網域產生，正式網址定案後請從正式網址的後台下載再印刷。
      </p>
    </div>
  );
}
