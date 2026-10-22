import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime } from '../../api.js';

const SOURCE = { request: '請求', line_login: 'LINE 登入', mail: '寄信', process: '程式崩潰' };

// Decision 34. Numbers come from the Node process itself; the host's own limits (entry processes,
// throttling) are only in cPanel → Resource Usage.
export default function AdminSystem() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hours, setHours] = useState(3);
  const [auto, setAuto] = useState(true);

  const load = useCallback(() => {
    api(`/admin/system?hours=${hours}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [hours]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [auto, load]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">載入中…</p>;
  const { live, minutes, errors } = data;

  return (
    <>
      <div className="row">
        <h2 style={{ margin: 0 }}>系統狀態</h2>
        <span className="spacer" />
        <label className="check small"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 每 10 秒更新</label>
      </div>
      <p className="muted">這台 Node 程式自己量到的數字（程序 {live.pid}，{live.node}，已執行 {live.uptimeMin} 分鐘）。主機對帳號的限制（同時連線數、有沒有被限流）要看 cPanel → Resource Usage。</p>

      <div className="stats">
        <Stat value={live.perSecond} label="這分鐘每秒請求" />
        <Stat value={live.inFlight} label="正在處理的請求" />
        <Stat value={live.errors5xxThisMinute} label="這分鐘伺服器錯誤" warn={live.errors5xxThisMinute > 0} />
        <Stat value={`${live.rssMb} MB`} label="記憶體（RSS）" />
        <Stat value={`${live.dbBusy}/${live.dbPoolSize}`} label="資料庫連線使用中" />
        <Stat value={live.dbQueued ?? '–'} label="排隊等資料庫連線" warn={live.dbQueued > 0} />
        <Stat value={`${live.loopP99Ms} ms`} label="Node 忙碌延遲（p99）" warn={live.loopP99Ms > 100} />
        <Stat value={`${live.serverLoad1m}`} label={`整台主機負載（${live.serverCpus} 核）`} />
      </div>

      <div className="row" style={{ marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>每分鐘紀錄</h3>
        <span className="spacer" />
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ width: 'auto' }}>
          {[1, 3, 12, 24, 48].map((h) => <option key={h} value={h}>最近 {h} 小時</option>)}
        </select>
      </div>
      {minutes.length === 0 ? <p className="muted">還沒有紀錄（每分鐘寫一次）。</p> : (
        <div className="table-wrap">
          <table className="metrics-table">
            <thead>
              <tr>
                <th>時間</th><th>請求</th><th>4xx</th><th>5xx</th><th>回應 中位/95%/最慢 (ms)</th>
                <th>同時處理</th><th>記憶體 MB</th><th>CPU %</th><th>DB 最多使用</th><th>DB 排隊</th><th>忙碌延遲 ms</th>
              </tr>
            </thead>
            <tbody>
              {minutes.map((m) => (
                <tr key={m.minute}>
                  <td>{fmtTime(m.minute)}{m.processes > 1 && <span className="muted">（{m.processes} 程序）</span>}</td>
                  <td>{m.requests}</td>
                  <td>{m.status_4xx}</td>
                  <td className={m.status_5xx > 0 ? 'error' : ''}>{m.status_5xx}</td>
                  <td>{m.p50_ms ?? '–'} / {m.p95_ms ?? '–'} / {m.max_ms ?? '–'}</td>
                  <td>{m.max_in_flight}</td>
                  <td>{Number(m.rss_mb)}</td>
                  <td>{Number(m.cpu_pct)}</td>
                  <td>{m.db_max_busy}</td>
                  <td className={m.db_waits > 0 ? 'error' : ''}>{m.db_waits}</td>
                  <td>{m.loop_p99_ms ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>最近的錯誤</h3>
      {errors.length === 0 ? <p className="muted">沒有錯誤紀錄。</p> : errors.map((e) => (
        <details key={e.id} className="error-log">
          <summary>
            <span className="tag">{SOURCE[e.source] || e.source}</span>
            <span className="muted small">{fmtTime(e.created_at)}</span>
            {e.path && <code className="small">{e.method} {e.path}</code>}
            <span className="error-log-msg">{e.message}</span>
          </summary>
          {e.stack ? <pre>{e.stack}</pre> : <p className="muted small">沒有堆疊資訊。</p>}
        </details>
      ))}
    </>
  );
}

const Stat = ({ value, label, warn }) => (
  <div className={`stat ${warn ? 'stat-warn' : ''}`}><b>{value}</b><span>{label}</span></div>
);
