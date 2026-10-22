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
  const [mergeEmail, setMergeEmail] = useState(null); // set when the server offers to merge (decision 33)

  useEffect(() => {
    if (user === null) navigate(`/login?next=${encodeURIComponent(`/profile?next=${encodeURIComponent(next)}`)}`, { replace: true });
    if (user && !form) {
      const p = user.profile || {};
      setForm({
        nickname: p.nickname || user.lineName || '', region: p.region || '', bio: p.bio || '',
        line_id: p.line_id || '', instagram: p.instagram || '', phone: p.phone || '',
        contact_email: p.contact_email || '', consent: false,
      });
    }
  }, [user, form, navigate, next]);

  if (!user || !form) return <Loading />;
  if (user.isAdmin) return <main className="page"><Brand /><p className="error">管理者帳號不參與抽蛋。</p></main>;

  const isNew = !user.profile;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (extra = {}) => {
    setError(''); setBusy(true);
    try {
      await api('/me/profile', { method: 'PUT', body: { ...form, ...extra } });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      if (err.code === 'MERGE_AVAILABLE') setMergeEmail(form.contact_email.trim().toLowerCase());
      else setError(err.message);
    } finally { setBusy(false); }
  };
  const submit = (e) => { e.preventDefault(); save(); };

  if (mergeEmail) {
    return (
      <main className="page">
        <Brand subtitle="你之前參加過嗎？" />
        <MergeAccount email={mergeEmail} form={form} onDone={async () => { await refresh(); navigate(next, { replace: true }); }}
          onSkip={() => { setMergeEmail(null); save({ skip_merge: true }); }} onBack={() => setMergeEmail(null)} />
      </main>
    );
  }

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

        <h3 className="form-section">聯絡方式 <span className="muted" style={{ fontWeight: 400 }}>LINE、IG、Email 至少填一種，抽中後才顯示</span></h3>
        <label htmlFor="line_id">LINE ID</label>
        <input id="line_id" maxLength={100} value={form.line_id} onChange={set('line_id')} autoCapitalize="off" />
        <label htmlFor="instagram">Instagram</label>
        <input id="instagram" maxLength={100} value={form.instagram} onChange={set('instagram')} autoCapitalize="off" placeholder="@帳號" />
        <label htmlFor="phone">電話（選填）</label>
        <input id="phone" type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
        <label htmlFor="contact_email">Email</label>
        <input id="contact_email" type="email" inputMode="email" maxLength={255} value={form.contact_email} onChange={set('contact_email')} autoCapitalize="off" placeholder="you@example.com" />
        {user.email && !form.contact_email && (
          <button type="button" className="link-button" style={{ marginTop: 6 }} onClick={() => setForm({ ...form, contact_email: user.email })}>填入我的登入 Email（{user.email}）</button>
        )}
        {!user.email && (
          <p className="muted small">你用 LINE 登入，沒有提供 Email。這裡填了 Email 的話，扭蛋被抽到時通知信會寄到這裡；沒填也沒關係，回到活動頁或首頁就看得到是誰抽到的。</p>
        )}

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

// A first-time LINE user typed the email of an existing account. Proving the email with a code merges
// this LINE login into that account; "not me" creates a separate account instead.
function MergeAccount({ email, form, onDone, onSkip, onBack }) {
  const [step, setStep] = useState('ask');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError(''); setBusy(true);
    try {
      await api('/auth/request-code', { method: 'POST', body: { email } });
      setStep('code'); setCooldown(60);
    } catch (err) {
      if (err.status === 429) setStep('code'); // a code was sent moments ago; it still works
      setError(err.message);
    } finally { setBusy(false); }
  };

  const merge = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/me/merge', { method: 'POST', body: { ...form, email, code } });
      await onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (step === 'ask') {
    return (
      <div className="card">
        <p style={{ marginTop: 0 }}><b>{email}</b> 已經有參加紀錄（之前用 Email 登入的帳號）。</p>
        <p>如果是你本人，我們寄一組驗證碼到這個信箱，確認後就把這次的 LINE 登入合併進去：之前的扭蛋和紀錄都會保留，基本資料會更新成你剛剛填的。</p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn btn-block" disabled={busy} onClick={sendCode}>{busy ? '寄送中…' : '是我，寄驗證碼'}</button>
        <button type="button" className="btn btn-block btn-ghost" disabled={busy} onClick={onSkip}>不是我，建立新帳號</button>
        <button type="button" className="link-button" onClick={onBack}>回去修改資料</button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={merge}>
      <p style={{ marginTop: 0 }}>驗證碼已寄到 <b>{email}</b>，10 分鐘內有效。</p>
      <p className="muted">沒收到的話，看一下垃圾信匣。</p>
      <label htmlFor="merge-code">6 位數驗證碼</label>
      <input id="merge-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      {error && <p className="error">{error}</p>}
      <button className="btn btn-block" disabled={busy || code.length !== 6}>{busy ? '合併中…' : '確認合併'}</button>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>回去修改資料</button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={cooldown > 0 || busy} onClick={sendCode}>
          {cooldown > 0 ? `${cooldown} 秒後可重寄` : '重寄驗證碼'}
        </button>
      </div>
    </form>
  );
}
