// culture.machine main module. cPanel loads it through server.cjs (see there).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './server/config.js';
import { pool, migrate } from './server/db.js';
import { authRouter, loadSession } from './server/auth.js';
import { adminRouter } from './server/admin.js';
import { publicRouter } from './server/public-api.js';
import { participantRouter } from './server/participant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

// Don't crash on a bad DB config: keep serving so /api/health can show the error.
let dbError = null;
await migrate().catch((err) => {
  dbError = err.message || err.code || String(err);
  console.error('DB migrate failed:', dbError);
});

const app = express();
app.set('trust proxy', 1); // Passenger/Apache sits in front; needed for secure cookies.
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT VERSION() AS db_version');
    res.json({ ok: true, node: process.version, db: row.db_version, mode: env.NODE_ENV || 'development', migrateError: dbError });
  } catch (err) {
    res.status(500).json({ ok: false, node: process.version, error: err.message || err.code });
  }
});

app.use('/api', loadSession);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', participantRouter);
app.use('/api', publicRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// React build output (web/ → public/). Unknown paths fall back to index.html for client-side routing.
app.use(express.static(publicDir));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : (err.message || err.code || '伺服器錯誤') });
});

// Passenger supplies PORT (or hooks listen); 3000 is for local dev.
app.listen(Number(env.PORT || 3000), () => {
  console.log(`culture.machine listening on ${env.PORT || 3000}`);
});
