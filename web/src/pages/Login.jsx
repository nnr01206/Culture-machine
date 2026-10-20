import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, safeNext } from '../api.js';
import { useAuth } from '../auth.jsx';

// Shown after LINE sends the user back here (see server/line.js).
const LINE_ERRORS = {
  line_cancel: '你取消了 LINE 登入。',
  line_expired: '登入連結已經失效，請再按一次「用 LINE 登入」。',
  line_failed: 'LINE 登入失敗，請再試一次，或改用 Email 登入。',
  line_off: 'LINE 登入還沒開放，請用 Email 登入。',
};

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const next = params.get('next');
  // Admins sign in by email only, so the admin login skips the LINE button.
  const forAdmin = Boolean(next?.startsWith('/admin'));
  const [lineOn, setLineOn] = useState(null); // null = still asking the server
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(LINE_ERRORS[params.get('error')] || '');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (forAdmin) return;
    api('/auth/options').then((o) => setLineOn(o.line)).catch(() => setLineOn(false));
  }, [forAdmin]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async (e) => {
    e?.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/auth/request-code', { method: 'POST', body: { email } });
      setStep('code');
      setCooldown(60);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api('/auth/verify', { method: 'POST', body: { email, code } });
      await refresh();
      navigate(safeNext(next, r.isAdmin ? '/admin' : '/'), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1 className="brand">文化扭蛋機</h1>
      <div className="card login-card">
        {step === 'email' ? (
          <>
            <h2 className="login-title">登入</h2>
            <form onSubmit={requestCode}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" inputMode="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              {error && <p className="error">{error}</p>}
              <button className="btn btn-block" disabled={busy}>{busy ? '寄送中…' : '寄驗證碼給我'}</button>
            </form>
            <p className="muted small login-hint">我們會寄 6 位數驗證碼到這個信箱，不用設定密碼。</p>
            {lineOn && (
              <>
                <div className="divider"><span>或</span></div>
                {/* A full page load, not a router link: the server sends the browser on to LINE. */}
                <a className="btn btn-block btn-line" href={`/api/auth/line/start?next=${encodeURIComponent(safeNext(next))}`}>
                  <LineIcon />用 LINE 登入
                </a>
              </>
            )}
          </>
        ) : (
          <form onSubmit={verify}>
            <h2 className="login-title">輸入驗證碼</h2>
            <p style={{ marginTop: 0 }}>驗證碼已寄到 <b>{email}</b>，10 分鐘內有效。</p>
            <p className="muted">沒收到的話，看一下垃圾信匣。</p>
            <label htmlFor="code">6 位數驗證碼</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            {error && <p className="error">{error}</p>}
            <button className="btn btn-block" disabled={busy || code.length !== 6}>{busy ? '驗證中…' : '登入'}</button>
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('email'); setCode(''); setError(''); }}>換一個 Email</button>
              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-sm" disabled={cooldown > 0 || busy} onClick={requestCode}>
                {cooldown > 0 ? `${cooldown} 秒後可重寄` : '重寄驗證碼'}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

// LINE's green chat-bubble mark, drawn small next to the button label.
const LineIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="#06c755" />
    <path d="M12 5.2c-4.1 0-7.4 2.6-7.4 5.9 0 2.9 2.6 5.4 6.2 5.8.3.1.6.2.7.4.1.2 0 .5 0 .7l-.1.7c0 .2-.2.8.7.4.9-.4 4.8-2.8 6.5-4.8 1.2-1.3 1.8-2.6 1.8-3.2 0-3.3-3.3-5.9-7.4-5.9z" fill="#fff" />
    <text x="12" y="12.9" textAnchor="middle" fontSize="4.6" fontWeight="800" fontFamily="Arial, sans-serif" fill="#06c755">LINE</text>
  </svg>
);
