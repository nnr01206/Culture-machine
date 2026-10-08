import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import QRCode from 'qrcode';
import { CategoryIcon } from '../../icons.jsx';
import { api, CATEGORIES, DURATIONS, CAPSULE_STATUS, categoryLabel, durationLabel, fmtTime } from '../../api.js';

export default function AdminActivity() {
  const { id } = useParams();
  const [activity, setActivity] = useState(null);
  const [roundId, setRoundId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const a = await api(`/admin/activities/${id}`);
      setActivity(a);
      setRoundId((cur) => (cur && a.rounds.some((r) => r.id === cur) ? cur : a.rounds[0]?.id ?? null));
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!activity) return <p className="muted">載入中…</p>;

  const openRound = activity.rounds.find((r) => r.is_open);
  const round = activity.rounds.find((r) => r.id === roundId);

  return (
    <>
      <h2>{activity.name}</h2>
      <QrBlock slug={activity.slug} />
      <OrganizerForm activity={activity} onSaved={load} />
      <RoundControl activityId={activity.id} openRound={openRound} onChanged={load} />

      {activity.rounds.length > 0 && (
        <>
          <label>查看輪次</label>
          <select value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))}>
            {activity.rounds.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.is_open ? '（進行中）' : `（${fmtTime(r.ends_at)} 結束）`}</option>
            ))}
          </select>
          {round && <RoundTabs key={round.id} round={round} />}
        </>
      )}
    </>
  );
}

function QrBlock({ slug }) {
  const url = `${window.location.origin}/activity?id=${slug}`;
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { width: 1024, margin: 2, color: { dark: '#E05A2B', light: '#FFFFFF' } }).then(setSrc);
  }, [url]);
  return (
    <div className="card-soft qr">
      {src && <img src={src} alt="活動 QR Code" />}
      <div>
        <p style={{ marginTop: 0 }}>活動網址（固定，不隨輪次改變）</p>
        <p><a href={url} target="_blank" rel="noreferrer"><code>{url}</code></a></p>
        {src && <a className="btn btn-sm" href={src} download={`culture-machine-${slug}.png`}>下載 QR Code</a>}
        <p className="muted">QR Code 跟著目前打開後台的網域產生。正式網址定案後，請從正式網址的後台下載再印刷。</p>
      </div>
    </div>
  );
}

function OrganizerForm({ activity, onSaved }) {
  const [form, setForm] = useState({
    name: activity.name,
    organizer_name: activity.organizer_name,
    organizer_contact: activity.organizer_contact,
  });
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/admin/activities/${activity.id}`, { method: 'PATCH', body: form });
      setMsg('已儲存');
      onSaved();
    } catch (err) { setMsg(err.message); }
  };
  return (
    <details className="card-soft">
      <summary>活動與主辦方資料</summary>
      <form onSubmit={save}>
        <label>活動名稱</label>
        <input required value={form.name} onChange={set('name')} />
        <label>主辦方名稱</label>
        <input required value={form.organizer_name} onChange={set('organizer_name')} />
        <label>主辦方聯絡方式（主辦方的蛋被抽中時顯示）</label>
        <input required value={form.organizer_contact} onChange={set('organizer_contact')} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-sm">儲存</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </form>
    </details>
  );
}

function RoundControl({ activityId, openRound, onChanged }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const start = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/admin/activities/${activityId}/rounds`, { method: 'POST', body: { name } });
      setName('');
      onChanged();
    } catch (err) { setError(err.message); }
  };
  const end = async () => {
    // Deliberately no window.confirm: a two-step button instead.
    setError('');
    try {
      await api(`/admin/rounds/${openRound.id}/end`, { method: 'POST' });
      onChanged();
    } catch (err) { setError(err.message); }
  };
  const [armed, setArmed] = useState(false);

  return (
    <div className="card">
      {openRound ? (
        <div className="row">
          <span>進行中：<b>{openRound.name}</b></span>
          <span className="muted">{fmtTime(openRound.starts_at)} 開始</span>
          <span className="spacer" />
          {armed ? (
            <>
              <span className="error">結束後就不能再投蛋、抽蛋</span>
              <button className="btn btn-sm" onClick={end}>確定結束</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setArmed(false)}>取消</button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setArmed(true)}>結束本輪</button>
          )}
        </div>
      ) : (
        <form onSubmit={start}>
          <p style={{ marginTop: 0 }}>目前沒有進行中的輪次。</p>
          <div className="row">
            <input style={{ flex: 1, minWidth: 180 }} required value={name} onChange={(e) => setName(e.target.value)} placeholder="新一輪名稱，例如：2026 冬・台東場" />
            <button className="btn">開新一輪</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const TABS = [
  ['overview', '總覽'],
  ['capsules', '扭蛋'],
  ['participants', '參與者'],
  ['draws', '配對'],
  ['new', '新增主辦方扭蛋'],
];

function RoundTabs({ round }) {
  const [tab, setTab] = useState('overview');
  const [version, setVersion] = useState(0); // bump to make tabs reload after a change
  return (
    <>
      <div className="tabs">
        {TABS.filter(([k]) => k !== 'new' || round.is_open).map(([k, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview roundId={round.id} version={version} />}
      {tab === 'capsules' && <Capsules roundId={round.id} version={version} onChanged={() => setVersion((v) => v + 1)} />}
      {tab === 'participants' && <Participants roundId={round.id} version={version} />}
      {tab === 'draws' && <Draws roundId={round.id} version={version} />}
      {tab === 'new' && <NewCapsule roundId={round.id} onCreated={() => { setVersion((v) => v + 1); setTab('capsules'); }} />}
    </>
  );
}

function useRoundData(path, version) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => api(path).then(setData).catch((e) => setError(e.message)), [path]);
  useEffect(() => { reload(); }, [reload, version]);
  return { data, error, reload };
}

function Overview({ roundId, version }) {
  const { data, error } = useRoundData(`/admin/rounds/${roundId}/overview`, version);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">載入中…</p>;
  const max = Math.max(1, ...Object.values(data.byCategory));
  return (
    <>
      <div className="stats">
        <Stat n={data.participants} label="投入人數" />
        <Stat n={data.capsules.total} label="扭蛋總數" />
        <Stat n={data.capsules.open} label="可抽取" />
        <Stat n={data.capsules.drawn} label="已抽取" />
        <Stat n={data.draws.completed} label="已完成（待定）" />
        <Stat n={data.specialRemaining} label="特別蛋剩餘次數" />
      </div>
      <h3>類別分布</h3>
      <div className="bars">
        {CATEGORIES.map((c) => (
          <div className="bar" key={c.key}>
            <span className="bar-label"><CategoryIcon category={c.key} size={16} /> {c.label}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(data.byCategory[c.key] / max) * 100}%` }} /></div>
            <span>{data.byCategory[c.key]}</span>
          </div>
        ))}
      </div>
      <p className="muted">不含特別蛋與已下架的扭蛋。「已完成」要等交換狀態回報方式決定後才會有數字。</p>
    </>
  );
}

const Stat = ({ n, label }) => <div className="stat"><b>{n}</b><span>{label}</span></div>;

function Capsules({ roundId, version, onChanged }) {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const qs = new URLSearchParams({ ...(status && { status }), ...(category && { category }) }).toString();
  const { data, error, reload } = useRoundData(`/admin/rounds/${roundId}/capsules${qs ? `?${qs}` : ''}`, version);
  const [actionError, setActionError] = useState('');

  const act = async (id, action) => {
    setActionError('');
    try {
      await api(`/admin/capsules/${id}/${action}`, { method: 'POST' });
      reload();
      onChanged();
    } catch (err) { setActionError(err.message); }
  };

  return (
    <>
      <div className="row">
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(CAPSULE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">全部類別</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {!data ? <p className="muted">載入中…</p> : data.length === 0 ? <p className="muted">沒有符合的扭蛋。</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>扭蛋</th><th>類別</th><th>時間</th><th>提供者</th><th>抽取</th><th>狀態</th><th></th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>
                    <b>{c.title}</b>
                    {c.is_special ? <> <span className="tag tag-solid">特別蛋</span></> : null}
                    <div className="muted">{c.description}</div>
                    {c.conditions && <div className="muted">條件：{c.conditions}</div>}
                  </td>
                  <td>{categoryLabel(c.category)}</td>
                  <td>{durationLabel(c.duration)}</td>
                  <td>{c.user_id ? <>{c.nickname}<div className="muted">{c.email}</div></> : <span className="tag">主辦方</span>}</td>
                  <td>{c.draw_count} / {c.max_draws}</td>
                  <td><span className={`tag ${c.status === 'removed' ? 'tag-muted' : ''}`}>{CAPSULE_STATUS[c.status]}</span></td>
                  <td>
                    {c.status !== 'removed' && <button className="btn btn-ghost btn-sm" onClick={() => act(c.id, 'remove')}>下架</button>}
                    {c.status !== 'open' && <button className="btn btn-ghost btn-sm" onClick={() => act(c.id, 'reopen')}>重新開放</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Participants({ roundId, version }) {
  const { data, error } = useRoundData(`/admin/rounds/${roundId}/participants`, version);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">載入中…</p>;
  if (!data.length) return <p className="muted">這一輪還沒有人投蛋。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>暱稱</th><th>Email</th><th>地區</th><th>投了幾顆</th><th>抽了幾次</th></tr></thead>
        <tbody>
          {data.map((u) => (
            <tr key={u.id}><td>{u.nickname}</td><td>{u.email}</td><td>{u.region}</td><td>{u.capsule_count}</td><td>{u.draw_count}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Draws({ roundId, version }) {
  const { data, error } = useRoundData(`/admin/rounds/${roundId}/draws`, version);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">載入中…</p>;
  if (!data.length) return <p className="muted">這一輪還沒有人抽蛋。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>抽取時間</th><th>抽到的人</th><th>扭蛋</th><th>提供者</th><th>狀態</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id}>
              <td>{fmtTime(d.created_at)}</td>
              <td>{d.drawer_nickname}<div className="muted">{d.drawer_email}</div></td>
              <td>#{d.capsule_id} {d.title} {d.is_special ? <span className="tag tag-solid">特別蛋</span> : null}</td>
              <td>{d.provider_nickname || <span className="tag">主辦方</span>}</td>
              <td><span className="tag">已抽取</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY = { category: 'skill', title: '', description: '', duration: '1h', conditions: '', is_special: false, max_draws: 5 };

function NewCapsule({ roundId, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api(`/admin/rounds/${roundId}/capsules`, {
        method: 'POST',
        body: { ...form, max_draws: Number(form.max_draws) },
      });
      setForm(EMPTY);
      onCreated();
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="card-soft" onSubmit={submit}>
      <p className="muted" style={{ marginTop: 0 }}>由主辦方提供的扭蛋，抽中時顯示活動的主辦方名稱與聯絡方式。</p>
      <label>我願意提供什麼（標題）</label>
      <input required maxLength={100} value={form.title} onChange={set('title')} placeholder="例如：街角書店請你喝一杯咖啡" />
      <label>類別</label>
      <select value={form.category} onChange={set('category')}>
        {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <label>內容說明</label>
      <textarea required value={form.description} onChange={set('description')} />
      <label>需要多少時間</label>
      <select value={form.duration} onChange={set('duration')}>
        {DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
      <label>使用條件（選填）</label>
      <textarea value={form.conditions} onChange={set('conditions')} placeholder="例如：限平日下午、需提前三天約" />
      <label className="check"><input type="checkbox" checked={form.is_special} onChange={set('is_special')} /> 設為特別蛋（只在有人抽不到時當備援）</label>
      {form.is_special && (
        <>
          <label>可被抽的次數</label>
          <input type="number" min={1} max={999} required value={form.max_draws} onChange={set('max_draws')} />
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-block">新增扭蛋</button>
    </form>
  );
}
