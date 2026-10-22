// Load test: many people grabbing capsules at once, through the real draw API (decision 36).
// Needs LOAD_TEST=1 on the target server (never production) and an admin cm_session.
//
//   node scripts/load-draw.mjs --base https://dev.culture.machine.inwave-studio.com --mode drain
//   node scripts/load-draw.mjs --mode timed --duration 20
//   node scripts/load-draw.mjs --cleanup            # remove the test data (kept after each run so it can be inspected)
//
// Options: --base URL (default http://localhost:3000)  --mode drain|timed  --concurrency 5
//          --duration 20 (timed mode, seconds)  --users 200  --double-tap 0.15
// The admin session is read from ADMIN_SESSION, or asked for without echoing. It is never saved.

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (!a.startsWith('--')) return acc;
  const next = all[i + 1];
  acc.push([a.slice(2), next && !next.startsWith('--') ? next : true]);
  return acc;
}, []));
const BASE = String(args.base || 'http://localhost:3000').replace(/\/+$/, '');
const MODE = args.mode || 'drain';
const CONCURRENCY = Number(args.concurrency || 5);
const DURATION_S = Number(args.duration || 20);
const USERS = Number(args.users || 200);
const DOUBLE_TAP = Number(args['double-tap'] ?? 0.15);
const TIMEOUT_MS = 30_000;
const DRAIN_TARGET_S = 60;

const host = new URL(BASE).hostname;
if (host === 'culture-machine.org' || host === 'www.culture-machine.org') {
  console.error('拒絕執行：這是正式站。壓測只在測試站或本機跑。');
  process.exit(2);
}
if (!['drain', 'timed'].includes(MODE)) { console.error('--mode 只能是 drain 或 timed'); process.exit(2); }

async function askHidden(question) {
  process.stdout.write(question);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  let value = '';
  return new Promise((resolve) => {
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode?.(false); process.stdin.pause(); process.stdin.off('data', onData);
          process.stdout.write('\n'); return resolve(value.trim());
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f') value = value.slice(0, -1); else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

let adminSession = process.env.ADMIN_SESSION || await askHidden('貼上管理員的 cm_session（不會顯示）：');
adminSession = adminSession.replace(/^cm_session=/, '');
if (!adminSession) { console.error('需要管理員的 cm_session'); process.exit(2); }

async function call(path, { method = 'GET', body, session = adminSession } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { cookie: `cm_session=${session}`, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data, ms: performance.now() - t0 };
  } catch (err) {
    return { status: 0, data: { error: err.name === 'TimeoutError' ? '逾時' : err.message }, ms: performance.now() - t0 };
  }
}

async function cleanup() {
  const r = await call('/admin/loadtest', { method: 'DELETE' });
  if (r.status === 200) console.log(`已清除壓測資料：${Object.entries(r.data.deleted).map(([k, v]) => `${k} ${v}`).join('、')}`);
  else console.error(`清除失敗（${r.status}）：${r.data?.error}`);
}

if (args.cleanup) { await cleanup(); process.exit(0); }

// ---- 1. Setup
const setup = await call('/admin/loadtest/setup', { method: 'POST', body: { users: USERS, capsulesPerUser: 1 } });
if (setup.status !== 201) {
  const hint = setup.status === 404 ? '（伺服器沒開 LOAD_TEST=1、是正式模式，或 cm_session 不是管理員）'
    : setup.status === 401 ? '（cm_session 無效或過期，請重新登入後台再複製）'
      : setup.status === 409 && /還在/.test(setup.data?.error || '') ? `\n看完上一次的資料後清除：node scripts/load-draw.mjs --base ${BASE} --cleanup` : '';
  console.error(`setup 失敗（${setup.status}）：${setup.data?.error}${hint}`);
  process.exit(1);
}
const { slug, poolSize, userIds, tokens } = setup.data;

// ---- 2. Draw
// One job per user; some users "double tap": two draw requests at the same moment.
const doubleTap = new Set([...userIds.keys()].sort(() => Math.random() - 0.5).slice(0, Math.round(userIds.length * DOUBLE_TAP)));
const queue = userIds.map((id, i) => ({ userId: id, token: tokens[i], taps: doubleTap.has(i) ? 2 : 1 }));
const outcomes = []; // { kind, status, ms, userId, drawId, capsuleId, error }

const classify = (r) => {
  if (r.status === 200) return 'success';
  if (r.status === 409 && r.data?.code === 'EMPTY') return 'empty';
  if (r.status === 409 && /資格/.test(r.data?.error || '')) return 'no_credit';
  if (r.status === 0) return 'network';
  if (r.status >= 500) return 'server';
  return 'other4xx';
};

const startedAt = new Date();
const t0 = performance.now();
const deadline = MODE === 'timed' ? t0 + DURATION_S * 1000 : Infinity;
let next = 0;
let drainedAt = null;

async function worker() {
  while (next < queue.length && performance.now() < deadline) {
    const job = queue[next++];
    const results = await Promise.all(Array.from({ length: job.taps }, () =>
      call(`/activities/${encodeURIComponent(slug)}/draw`, { method: 'POST', session: job.token })));
    for (const r of results) {
      outcomes.push({
        kind: classify(r), status: r.status, ms: r.ms, userId: job.userId,
        drawId: r.data?.draw_id, capsuleId: r.data?.capsule?.id, error: r.data?.error,
        doneAt: performance.now(),
      });
    }
  }
}
console.log(`開始：${MODE === 'drain' ? '搶完模式' : `固定時間模式 ${DURATION_S} 秒`}，${userIds.length} 人、${CONCURRENCY} 條連線、${doubleTap.size} 人同時按兩次…`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const elapsedS = (performance.now() - t0) / 1000;
if (next >= queue.length) drainedAt = elapsedS;

// ---- 3. Report
const successes = outcomes.filter((o) => o.kind === 'success');
const report = await call('/admin/loadtest/report', {
  method: 'POST',
  body: { startedAt, results: successes.map((o) => ({ userId: o.userId, drawId: o.drawId, capsuleId: o.capsuleId })) },
});

// ---- 4. Print
const count = (k) => outcomes.filter((o) => o.kind === k).length;
const sorted = outcomes.map((o) => o.ms).sort((a, b) => a - b);
const pct = (p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]) : 0);
const inWindow = MODE === 'timed' ? successes.filter((o) => o.doneAt <= deadline).length : successes.length;
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

console.log(`\n壓測：${MODE === 'drain' ? '搶完模式' : '固定時間模式'}　網站 ${host}`);
console.log(`${userIds.length} 人・池子 ${poolSize} 顆・${CONCURRENCY} 條連線・${doubleTap.size} 人同時按兩次\n`);
if (MODE === 'drain') {
  console.log(`搶完時間      ${elapsedS.toFixed(1)} 秒（目標 ${DRAIN_TARGET_S} 秒）${elapsedS <= DRAIN_TARGET_S ? '✅' : '⚠️'}`);
} else {
  console.log(`${DURATION_S} 秒內成功  ${inWindow} 次${drainedAt !== null && drainedAt < DURATION_S ? `（${drainedAt.toFixed(1)} 秒就全部抽完）` : ''}`);
}
console.log(`請求總數      ${outcomes.length}`);
console.log(`  成功        ${count('success')}`);
console.log(`  沒有蛋了    ${count('empty')}`);
console.log(`  沒有資格    ${count('no_credit')}   ← 同時按兩次的第二下`);
console.log(`  其他 4xx    ${count('other4xx')}   ${count('other4xx') ? '⚠️' : ''}`);
console.log(`  伺服器錯誤  ${count('server')}   ${count('server') ? '❌' : '✅'}`);
console.log(`  連線失敗    ${count('network')}   ${count('network') ? '❌' : '✅'}`);
console.log(`回應時間      中位數 ${fmtMs(pct(0.5))}　95% ${fmtMs(pct(0.95))}　最慢 ${fmtMs(pct(1))}`);
const problems = outcomes.filter((o) => ['other4xx', 'server', 'network'].includes(o.kind));
if (problems.length) {
  const byMsg = {};
  for (const p of problems) byMsg[`${p.status} ${p.error || ''}`] = (byMsg[`${p.status} ${p.error || ''}`] || 0) + 1;
  console.log('  問題明細：');
  for (const [m, n] of Object.entries(byMsg)) console.log(`    ${n} 次  ${m}`);
}

let checksOk = false;
if (report.status === 200) {
  console.log('\n規則檢查');
  for (const c of report.data.checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? `：${c.detail}` : ''}`);
  checksOk = report.data.checks.every((c) => c.ok);
  console.log(`  資料庫裡共 ${report.data.draws} 筆抽取，池子剩 ${report.data.poolLeft} 顆`);
  const m = report.data.metrics;
  if (m.length) {
    const max = (k) => Math.max(...m.map((x) => Number(x[k]) || 0));
    console.log(`\n系統（壓測期間每分鐘最大值，伺服器每分鐘才寫一次，剛結束的那分鐘可能還沒進來）`);
    console.log(`  同時處理 ${max('max_in_flight')}　資料庫連線 ${max('db_max_busy')}　排隊等連線 ${max('db_waits')} 次　記憶體 ${max('rss_mb')} MB　Node 忙碌延遲 ${max('loop_p99_ms')} ms`);
  }
} else {
  console.log(`\n規則檢查失敗（${report.status}）：${report.data?.error}`);
}

const pass = checksOk && !count('server') && !count('network') && !count('other4xx');
console.log(`\n結論：${pass ? '通過' : '不通過'}`);

// ---- 5. The test data stays so it can be inspected in the admin pages; it is removed only on request.
console.log(`\n壓測資料保留著：後台「活動」裡的「【壓測】多人搶扭蛋」可以看每一筆抽取（測試帳號的登入 1 小時後失效）。`);
console.log(`看完後清除：node scripts/load-draw.mjs --base ${BASE} --cleanup`);
console.log('下一次壓測前一定要先清除，否則會被拒絕。');
process.exit(pass ? 0 : 1);
