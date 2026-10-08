import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, safeNext } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

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
      navigate(safeNext(params.get('next'), r.isAdmin ? '/admin' : '/'), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1 className="brand">文化扭蛋機</h1>
      <p className="tagline">登入</p>
      {step === 'email' ? (
        <form className="card" onSubmit={requestCode}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" inputMode="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <p className="muted">我們會寄一組 6 位數驗證碼到這個信箱。</p>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-block" disabled={busy}>{busy ? '寄送中…' : '寄驗證碼給我'}</button>
        </form>
      ) : (
        <form className="card" onSubmit={verify}>
          <p>驗證碼已寄到 <b>{email}</b>，10 分鐘內有效。</p>
          <p className="muted">沒收到的話，看一下垃圾信匣。</p>
          <label htmlFor="code">6 位數驗證碼</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-block" disabled={busy || code.length !== 6}>{busy ? '驗證中…' : '登入'}</button>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('email'); setCode(''); }}>換一個 Email</button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-sm" disabled={cooldown > 0 || busy} onClick={requestCode}>
              {cooldown > 0 ? `${cooldown} 秒後可重寄` : '重寄驗證碼'}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
