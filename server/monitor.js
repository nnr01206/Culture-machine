// Self-monitoring (decision 34): per-minute traffic and resource numbers go to `metrics`, unexpected
// failures to `error_logs`, both readable on the admin "系統狀態" page.
// What Node can't see: the host's per-account limits (entry processes, faults when a limit is hit).
// Those are only in cPanel → Resource Usage.
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { pool } from './db.js';

const FLUSH_MS = 60 * 1000;
const MAX_SAMPLES = 20_000; // latency samples kept per minute; enough for any load this host can take
const METRICS_DAYS = 14;
const ERROR_DAYS = 90;

const startedAt = Date.now();
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

let inFlight = 0;
let dbBusy = 0;
let minute = freshMinute();
let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();

function freshMinute() {
  return { start: Date.now(), requests: 0, s4xx: 0, s5xx: 0, durations: [], maxInFlight: inFlight, dbMaxBusy: dbBusy, dbWaits: 0 };
}

// mysql2's pool emits these; they tell us how busy the DB connections are.
pool.pool.on('acquire', () => { dbBusy++; minute.dbMaxBusy = Math.max(minute.dbMaxBusy, dbBusy); });
pool.pool.on('release', () => { dbBusy = Math.max(0, dbBusy - 1); });
pool.pool.on('enqueue', () => { minute.dbWaits++; });

// Counts every request and how long it took. Mount before the routes.
export function monitorRequests(req, res, next) {
  const t0 = process.hrtime.bigint();
  inFlight++;
  minute.maxInFlight = Math.max(minute.maxInFlight, inFlight);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inFlight--;
    minute.requests++;
    if (res.statusCode >= 500) minute.s5xx++;
    else if (res.statusCode >= 400) minute.s4xx++;
    if (minute.durations.length < MAX_SAMPLES) minute.durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
  };
  res.on('finish', finish);
  res.on('close', finish); // client gave up before the response was sent
  next();
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
const mb = (bytes) => Math.round(bytes / 1048576 * 10) / 10;

function cpuPercent() {
  const now = Date.now();
  const used = process.cpuUsage(lastCpu);
  const pct = ((used.user + used.system) / 1000) / Math.max(1, now - lastCpuAt) * 100;
  lastCpu = process.cpuUsage();
  lastCpuAt = now;
  return Math.round(pct * 10) / 10;
}

// What is happening right now, for the admin page.
export function liveStats() {
  const mem = process.memoryUsage();
  const elapsed = Math.max(1, (Date.now() - minute.start) / 1000);
  return {
    pid: process.pid,
    node: process.version,
    uptimeMin: Math.round((Date.now() - startedAt) / 60000),
    rssMb: mb(mem.rss),
    heapMb: mb(mem.heapUsed),
    inFlight,
    requestsThisMinute: minute.requests,
    perSecond: Math.round(minute.requests / elapsed * 10) / 10,
    errors5xxThisMinute: minute.s5xx,
    dbBusy,
    dbPoolSize: pool.pool.config.connectionLimit,
    dbQueued: pool.pool._connectionQueue?.length ?? null, // mysql2 internal; may be absent in other versions
    loopP99Ms: Math.round(loop.percentile(99) / 1e5) / 10,
    // Whole-machine numbers: the shared server, not just this account.
    serverLoad1m: Math.round(os.loadavg()[0] * 100) / 100,
    serverCpus: os.cpus().length,
  };
}

let flushes = 0;
async function flush() {
  const m = minute;
  minute = freshMinute();
  const sorted = m.durations.sort((a, b) => a - b);
  const mem = process.memoryUsage();
  const row = {
    minute: new Date(m.start - (m.start % 60000)),
    pid: process.pid,
    requests: m.requests,
    status_4xx: m.s4xx,
    status_5xx: m.s5xx,
    p50_ms: sorted.length ? Math.round(percentile(sorted, 0.5)) : null,
    p95_ms: sorted.length ? Math.round(percentile(sorted, 0.95)) : null,
    max_ms: sorted.length ? Math.round(sorted.at(-1)) : null,
    max_in_flight: m.maxInFlight,
    rss_mb: mb(mem.rss),
    heap_mb: mb(mem.heapUsed),
    cpu_pct: cpuPercent(),
    loop_p99_ms: Math.round(loop.percentile(99) / 1e5) / 10,
    db_max_busy: m.dbMaxBusy,
    db_waits: m.dbWaits,
  };
  loop.reset();
  try {
    await pool.query('INSERT INTO metrics SET ?', [row]);
    if (++flushes % 60 === 0) { // hourly housekeeping
      await pool.query('DELETE FROM metrics WHERE minute < UTC_TIMESTAMP() - INTERVAL ? DAY', [METRICS_DAYS]);
      await pool.query('DELETE FROM error_logs WHERE created_at < UTC_TIMESTAMP() - INTERVAL ? DAY', [ERROR_DAYS]);
    }
  } catch (err) {
    console.error('metrics flush failed:', err.message || err.code);
  }
}

// Records an unexpected failure. Never throws: logging must not cause a second error.
export async function logError(source, err, req = null) {
  console.error(`[${source}]`, err);
  try {
    await pool.query('INSERT INTO error_logs SET ?', [{
      source,
      method: req?.method ?? null,
      path: req ? String(req.originalUrl || req.url).split('?')[0].slice(0, 255) : null,
      status: err?.status ?? null,
      message: String(err?.message || err?.code || err).slice(0, 1000),
      stack: err?.stack ? String(err.stack).slice(0, 8000) : null,
      pid: process.pid,
    }]);
  } catch (e) {
    console.error('error_logs write failed:', e.message || e.code);
  }
}

export function startMonitor() {
  setInterval(flush, FLUSH_MS).unref();
  process.on('unhandledRejection', (err) => { logError('process', err); });
  process.on('uncaughtException', (err) => {
    // State is unknown after this; record it, then let Passenger start a fresh process.
    logError('process', err).finally(() => process.exit(1));
  });
}
