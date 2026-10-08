import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, safeNext } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Brand, Loading } from '../components.jsx';
import { ConsentText } from '../consent.jsx';

const REGIONS = ['台東市', '卑南鄉', '鹿野鄉', '關山鎮', '池上鄉', '東河鄉', '成功鎮', '長濱鄉', '太麻里鄉', '金峰鄉', '大武鄉', '達仁鄉', '延平鄉', '海端鄉', '綠島鄉', '蘭嶼鄉', '台東以外'];

export default function Profile() {
  const { user, refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'), '/');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user === null) navigate(`/login?next=${encodeURIComponent(`/profile?next=${encodeURIComponent(next)}`)}`, { replace: true });
    if (user && !form) {
      const p = user.profile || {};
      setForm({
        nickname: p.nickname || '', region: p.region || '', bio: p.bio || '',
        line_id: p.line_id || '', instagram: p.instagram || '', phone: p.phone || '',
        show_email: Boolean(p.show_email), consent: false,
      });
    }
  }, [user, form, navigate, next]);

  if (!user || !form) return <Loading />;
  if (user.isAdmin) return <main className="page"><Brand /><p className="error">管理者帳號不參與抽蛋。</p></main>;

  const isNew = !user.profile;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/me/profile', { method: 'PUT', body: form });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <main className="page">
      <Brand subtitle={isNew ? '先認識你一下' : '編輯基本資料'} />
      <form className="card" onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>抽中前，別人看不到你的任何資料。</p>

        <label htmlFor="nickname">暱稱 <span className="req">*</span></label>
        <input id="nickname" required maxLength={50} value={form.nickname} onChange={set('nickname')} placeholder="大家怎麼稱呼你" />

        <label htmlFor="region">所在地區 <span className="req">*</span></label>
        <input id="region" required maxLength={50} list="regions" value={form.region} onChange={set('region')} placeholder="例如：台東市、池上" />
        <datalist id="regions">{REGIONS.map((r) => <option key={r} value={r} />)}</datalist>

        <label htmlFor="bio">一句自我介紹</label>
        <input id="bio" maxLength={200} value={form.bio} onChange={set('bio')} placeholder="例如：在池上開咖啡店，喜歡聊地方創業" />

        <h3 className="form-section">聯絡方式 <span className="muted" style={{ fontWeight: 400 }}>LINE 和 IG 至少填一種，抽中後才顯示</span></h3>
        <label htmlFor="line_id">LINE ID</label>
        <input id="line_id" maxLength={100} value={form.line_id} onChange={set('line_id')} autoCapitalize="off" />
        <label htmlFor="instagram">Instagram</label>
        <input id="instagram" maxLength={100} value={form.instagram} onChange={set('instagram')} autoCapitalize="off" placeholder="@帳號" />
        <label htmlFor="phone">電話（選填）</label>
        <input id="phone" type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
        <label className="check"><input type="checkbox" checked={form.show_email} onChange={set('show_email')} /> 抽中後也顯示我的 Email（{user.email}）</label>

        {isNew && (
          <>
            <ConsentText />
            <label className="check"><input type="checkbox" required checked={form.consent} onChange={set('consent')} /> 我已閱讀並同意個資使用說明 <span className="req">*</span></label>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-block" disabled={busy}>{busy ? '儲存中…' : isNew ? '完成，開始玩' : '儲存'}</button>
      </form>
    </main>
  );
}
