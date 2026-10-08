import { useState } from 'react';
import { api } from '../../api.js';

export default function AdminMailTest() {
  const [to, setTo] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setResult('寄送中…');
    try {
      const r = await api('/admin/mail-test', { method: 'POST', body: { to } });
      setResult(JSON.stringify(r, null, 2));
    } catch (err) {
      setResult(`失敗：${err.message}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <h2>SMTP 寄信測試</h2>
      <form className="card-soft" onSubmit={send}>
        <p className="muted">寄一封測試信，確認主機 SMTP 能用。收到後請看它在收件匣還是垃圾信匣。</p>
        <label>收件 Email</label>
        <input type="email" required value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn btn-block" disabled={busy}>寄測試信</button>
      </form>
      {result && <pre>{result}</pre>}
    </>
  );
}
