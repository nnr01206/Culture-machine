import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, CATEGORIES, DURATIONS } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Brand, CapsuleCard, Loading } from '../components.jsx';
import { CategoryIcon, HalfCapsule } from '../icons.jsx';

const EMPTY = { title: '', category: '', description: '', duration: '', conditions: '' };

// Capsule form → preview (decision 17) → submit. Immutable after submit (decision 16).
export default function Drop() {
  const [params] = useSearchParams();
  const slug = params.get('id') || '';
  const back = `/activity?id=${encodeURIComponent(slug)}`;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [step, setStep] = useState('form'); // form | preview | done
  const [credits, setCredits] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user === null) navigate(`/login?next=${encodeURIComponent(`/activity/drop?id=${slug}`)}`, { replace: true });
    else if (user && !user.isAdmin && !user.profile) navigate(back, { replace: true });
  }, [user, navigate, slug, back]);

  if (!user) return <Loading />;
  if (user.isAdmin) return <main className="page"><Brand /><p className="error">管理者帳號不參與抽蛋。</p></main>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toPreview = (e) => {
    e.preventDefault();
    if (!form.category) { setError('請選一個類別'); return; }
    setError('');
    setStep('preview');
    window.scrollTo(0, 0);
  };

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const r = await api(`/activities/${encodeURIComponent(slug)}/capsules`, { method: 'POST', body: form });
      setCredits(r.credits);
      setStep('done');
      window.scrollTo(0, 0);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (step === 'done') {
    return (
      <main className="page">
        <Brand subtitle="投入成功" />
        <div className="card center done-card">
          <HalfCapsule size={72} className="drop-in" />
          <h2 style={{ marginTop: 12 }}>你的扭蛋已經放進機器了！</h2>
          <p>你現在有 <b className="big-num">{credits}</b> 次抽取資格。</p>
          <Link className="btn btn-block btn-big" to={`/activity/draw?id=${encodeURIComponent(slug)}`}>去轉扭蛋機</Link>
          <Link className="btn btn-block btn-ghost" to={back}>回活動頁</Link>
        </div>
      </main>
    );
  }

  if (step === 'preview') {
    return (
      <main className="page">
        <Brand subtitle="再看一眼" />
        <p>你的扭蛋被抽到時，對方會看到這個樣子：</p>
        <CapsuleCard capsule={form} provider={{ nickname: user.profile.nickname, region: user.profile.region, bio: user.profile.bio }} />
        <p className="muted small">抽到的人還會看到你的聯絡方式。</p>
        <p className="warn">投入後無法修改。</p>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-block btn-big" onClick={submit} disabled={busy}>{busy ? '投入中…' : '確認投入'}</button>
        <button className="btn btn-block btn-ghost" onClick={() => setStep('form')} disabled={busy}>回去修改</button>
      </main>
    );
  }

  return (
    <main className="page">
      <Brand subtitle="投入一顆文化扭蛋" />
      <form className="card" onSubmit={toPreview}>
        <p className="muted" style={{ marginTop: 0 }}>準備一份「可控、可完成、可收穫」的輕量資源，作為你願意投入社群的小小行動。</p>

        <label htmlFor="title">我願意提供什麼 <span className="req">*</span></label>
        <input id="title" required maxLength={100} value={form.title} onChange={set('title')} placeholder="例如：我可以幫你拍一組活動照片" />

        <label>類別 <span className="req">*</span></label>
        <div className="cat-grid" role="radiogroup" aria-label="類別">
          {CATEGORIES.map((c) => (
            <button type="button" key={c.key} role="radio" aria-checked={form.category === c.key}
              className={`cat-option ${form.category === c.key ? 'selected' : ''}`}
              onClick={() => setForm({ ...form, category: c.key })}>
              <CategoryIcon category={c.key} size={26} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <label htmlFor="description">內容說明 <span className="req">*</span></label>
        <textarea id="description" required maxLength={1000} value={form.description} onChange={set('description')}
          placeholder="具體會做什麼、在哪裡、怎麼進行" />

        <label htmlFor="duration">需要多少時間 <span className="req">*</span></label>
        <select id="duration" required value={form.duration} onChange={set('duration')}>
          <option value="" disabled>請選擇</option>
          {DURATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <p className="muted small">文化扭蛋是輕量的分享，請控制在 5 小時內。</p>

        <label htmlFor="conditions">使用條件（選填）</label>
        <textarea id="conditions" maxLength={500} value={form.conditions} onChange={set('conditions')}
          placeholder="例如：限平日下午、需提前三天約、限台東市區" />

        {error && <p className="error">{error}</p>}
        <button className="btn btn-block btn-big">下一步：預覽</button>
        <Link className="btn btn-block btn-ghost" to={back}>取消</Link>
      </form>
    </main>
  );
}
