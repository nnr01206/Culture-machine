import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.js';

export default function AdminActivities() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ name: '', organizer_name: '', organizer_contact: '' });
  const [error, setError] = useState('');

  const load = () => api('/admin/activities').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/admin/activities', { method: 'POST', body: form });
      setForm({ name: '', organizer_name: '', organizer_contact: '' });
      load();
    } catch (err) { setError(err.message); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <h2>活動</h2>
      <p className="muted">每個活動有一個固定的 QR Code，底下可以一輪接一輪地辦。</p>
      {list === null ? <p className="muted">載入中…</p> : list.length === 0 ? (
        <p className="muted">還沒有活動，先在下面建立一個。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>活動</th><th>代碼</th><th>目前輪次</th><th>輪數</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/admin/activities/${a.id}`}>{a.name}</Link></td>
                  <td><code>{a.slug}</code></td>
                  <td>{a.open_round_name ? <span className="tag tag-solid">{a.open_round_name}</span> : <span className="tag tag-muted">無進行中</span>}</td>
                  <td>{a.round_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>建立活動</h2>
      <form className="card-soft" onSubmit={create}>
        <label>活動名稱</label>
        <input required value={form.name} onChange={set('name')} placeholder="例如：街角書店扭蛋機" />
        <label>主辦方名稱</label>
        <input required value={form.organizer_name} onChange={set('organizer_name')} placeholder="主辦方的蛋被抽中時顯示" />
        <label>主辦方聯絡方式</label>
        <input required value={form.organizer_contact} onChange={set('organizer_contact')} placeholder="例如：LINE @xxxx／電話" />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-block">建立</button>
      </form>
    </>
  );
}
