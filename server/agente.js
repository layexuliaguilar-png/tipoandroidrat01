'use strict';

module.exports = function montar(panel, H) {
  const { q, one, all, now, j, pj, db, requirePanel } = H;
  const dormir = (ms) => new Promise(r => setTimeout(r, ms));
  const AI = {
    key: process.env.VENICE_API_KEY || '',
    url: 'https://api.venice.ai/api/v1/chat/completions',
    model: process.env.AI_MODEL || 'qwen3-vl-235b-a22b'
  };
  try { const s = one('SELECT v FROM kv WHERE k=?', 'ai_model'); if (s && s.v) AI.model = s.v; } catch (e) { }

  db.exec(`CREATE TABLE IF NOT EXISTS missions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, orden TEXT NOT NULL,
    modo TEXT NOT NULL DEFAULT 'hibrido', estado TEXT NOT NULL DEFAULT 'corriendo',
    creada INTEGER NOT NULL, pasos INTEGER DEFAULT 0, resumen TEXT);
  CREATE TABLE IF NOT EXISTS steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id INTEGER NOT NULL, n INTEGER, ts INTEGER NOT NULL,
    pensamiento TEXT, accion TEXT, args TEXT, ok INTEGER, resultado TEXT, shot_id INTEGER);`);

  const agentes = new Map();

  const SISTEMA = [
    'Sos un agente que opera un celular Android. Recibis el texto visible de la pantalla y una orden.',
    'Respondes SOLO con un JSON, sin markdown ni texto fuera del JSON.',
    'Formato: {"pensamiento":"que ves y por que","accion":"...", ...campos}',
    '',
    'Acciones validas:',
    '{"accion":"tap_text","texto":"Enviar"}      tocar el nodo con ese texto',
    '{"accion":"tap","x":500,"y":1200}           tocar coordenadas',
    '{"accion":"text","texto":"50000"}           escribir en el campo con foco',
    '{"accion":"open","texto":"com.nequi.MobileApp"}',
    '{"accion":"swipe","x":500,"y":1500,"x2":500,"y2":600}',
    '{"accion":"back"}   {"accion":"home"}',
    '{"accion":"esperar","ms":2000}',
    '{"accion":"confirmar","texto":"Confirmar"}  pide aprobacion humana',
    '{"accion":"fin","resumen":"..."}            terminaste',
    '',
    'Reglas: UNA accion por respuesta. Si la pantalla esta vacia o cargando, espera.',
    'Para escribir un monto primero toca el campo. Usa confirmar antes de tocar lo que mueve plata.',
    'No inventes coordenadas. Si algo falla dos veces, cambia de ruta o termina con fin.'
  ].join('\n');

  function encolar(dev, cmd, args) {
    const r = q('INSERT INTO commands (device_id, cmd, args, status, created_at) VALUES (?,?,?,?,?)',
      dev, cmd, j(args || {}), 'queued', now());
    return Number(r.lastInsertRowid);
  }
  async function esperarCmd(id, ms) {
    const t0 = now();
    while (now() - t0 < (ms || 20000)) {
      const c = one('SELECT status, result FROM commands WHERE id=?', id);
      if (c && (c.status === 'done' || c.status === 'error')) return c;
      await dormir(400);
    }
    return { status: 'timeout', result: '' };
  }
  function parsear(txt) {
    const m = String(txt).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }
  async function llamarIA(msgs) {
    if (!AI.key) throw new Error('falta VENICE_API_KEY en Render');
    const r = await fetch(AI.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AI.key },
      body: JSON.stringify({ model: AI.model, messages: msgs, temperature: 0.2, max_tokens: 400 })
    });
    const txt = await r.text();
    let d = {};
    try { d = JSON.parse(txt); } catch (e) { throw new Error('IA no devolvio JSON: ' + txt.slice(0, 150)); }
    if (d.error) throw new Error('IA: ' + (d.error.message || JSON.stringify(d.error)));
    return d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '';
  }
  async function ejecutar(dev, a) {
    const mapa = {
      tap_text: ['tap_text', { text: a.texto }],
      tap: ['tap', { x: Number(a.x), y: Number(a.y) }],
      text: ['text', { text: a.texto }],
      open: ['open', { pkg: a.texto }],
      swipe: ['swipe', { x1: Number(a.x), y1: Number(a.y), x2: Number(a.x2), y2: Number(a.y2), ms: 260 }],
      back: ['back', {}], home: ['home', {}],
      esperar: ['sleep', { ms: Number(a.ms || 1500) }]
    };
    const par = mapa[a.accion];
    if (!par) return { ok: false, resultado: 'accion desconocida: ' + a.accion };
    const r = await esperarCmd(encolar(dev, par[0], par[1]), 20000);
    return { ok: r.status === 'done', resultado: String(r.result || r.status).slice(0, 400) };
  }
  async function esperarOperador(mid) {
    const t0 = now();
    while (now() - t0 < 900000) {
      const m = one('SELECT estado FROM missions WHERE id=?', mid);
      if (!m) return false;
      if (m.estado === 'parada') return false;
      if (m.estado === 'corriendo') return true;
      await dormir(800);
    }
    return false;
  }

  async function correr(mid) {
    const ctrl = { parar: false };
    agentes.set(mid, ctrl);
    const m = one('SELECT * FROM missions WHERE id=?', mid);
    try {
      for (let n = 1; n <= 30; n++) {
        if (ctrl.parar) { q("UPDATE missions SET estado='parada' WHERE id=?", mid); return; }
        const rd = await esperarCmd(encolar(m.device_id, 'dump', {}), 15000);
        let nodos = String(rd.result || '[]').slice(0, 7000);
        try { nodos = JSON.stringify(JSON.parse(rd.result || '[]').slice(0, 110)); } catch (e) { }
        encolar(m.device_id, 'screenshot', { force: true });
        await dormir(1500);
        const shot = one('SELECT id, data FROM shots WHERE device_id=? ORDER BY id DESC LIMIT 1', m.device_id);
        const hist = all('SELECT pensamiento, accion, args, resultado FROM steps WHERE mission_id=? ORDER BY id DESC LIMIT 6', mid).reverse();
        const msgs = [{ role: 'system', content: SISTEMA }];
        for (const h of hist) {
          msgs.push({ role: 'assistant', content: JSON.stringify(Object.assign({ pensamiento: h.pensamiento, accion: h.accion }, pj(h.args, {}))) });
          msgs.push({ role: 'user', content: 'resultado: ' + String(h.resultado || '').slice(0, 200) });
        }
        const cont = [{ type: 'text', text: 'ORDEN: ' + m.orden + '\n\nPANTALLA:\n' + nodos }];
        if (shot && shot.data) cont.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + shot.data } });
        msgs.push({ role: 'user', content: cont });

        const a = parsear(await llamarIA(msgs)) || { accion: 'esperar', ms: 2000, pensamiento: 'respuesta ilegible' };

        if (a.accion === 'fin') {
          q('INSERT INTO steps (mission_id, n, ts, pensamiento, accion, args, shot_id) VALUES (?,?,?,?,?,?,?)',
            mid, n, now(), a.pensamiento || '', 'fin', j(a), shot ? shot.id : null);
          q("UPDATE missions SET estado='terminada', resumen=? WHERE id=?", String(a.resumen || '').slice(0, 2000), mid);
          return;
        }
        if (a.accion === 'confirmar' || m.modo === 'copiloto') {
          q('INSERT INTO steps (mission_id, n, ts, pensamiento, accion, args, shot_id) VALUES (?,?,?,?,?,?,?)',
            mid, n, now(), a.pensamiento || '', a.accion, j(a), shot ? shot.id : null);
          q("UPDATE missions SET estado='esperando' WHERE id=?", mid);
          if (!(await esperarOperador(mid))) { q("UPDATE missions SET estado='parada' WHERE id=?", mid); return; }
          if (a.accion === 'confirmar') {
            const r2 = await ejecutar(m.device_id, { accion: 'tap_text', texto: a.texto });
            q('UPDATE steps SET ok=?, resultado=? WHERE mission_id=? AND n=?', r2.ok ? 1 : 0, r2.resultado, mid, n);
          }
          continue;
        }
        const res = await ejecutar(m.device_id, a);
        q('INSERT INTO steps (mission_id, n, ts, pensamiento, accion, args, ok, resultado, shot_id) VALUES (?,?,?,?,?,?,?,?,?)',
          mid, n, now(), a.pensamiento || '', a.accion, j(a), res.ok ? 1 : 0, res.resultado, shot ? shot.id : null);
        q('UPDATE missions SET pasos=? WHERE id=?', n, mid);
        await dormir(1200);
      }
      q("UPDATE missions SET estado='terminada', resumen='limite de 30 pasos' WHERE id=?", mid);
    } catch (e) {
      q("UPDATE missions SET estado='error', resumen=? WHERE id=?", String(e.message || e).slice(0, 800), mid);
    } finally { agentes.delete(mid); }
  }

  panel.post('/api/agent/iniciar', requirePanel, (req, res) => {
    const b = req.body || {};
    if (!b.device_id || !b.orden) return res.json({ ok: false, error: 'falta device_id u orden' });
    if (!AI.key) return res.json({ ok: false, error: 'falta VENICE_API_KEY en Render' });
    const r = q('INSERT INTO missions (device_id, orden, modo, estado, creada) VALUES (?,?,?,?,?)',
      b.device_id, String(b.orden).slice(0, 500), b.modo || 'hibrido', 'corriendo', now());
    const id = Number(r.lastInsertRowid);
    correr(id);
    res.json({ ok: true, id: id });
  });
  panel.post('/api/agent/parar', requirePanel, (req, res) => {
    const id = Number((req.body || {}).id);
    const c = agentes.get(id); if (c) c.parar = true;
    q("UPDATE missions SET estado='parada' WHERE id=? AND estado IN ('corriendo','esperando')", id);
    res.json({ ok: true });
  });
  panel.post('/api/agent/continuar', requirePanel, (req, res) => {
    q("UPDATE missions SET estado='corriendo' WHERE id=? AND estado='esperando'", Number((req.body || {}).id));
    res.json({ ok: true });
  });
  panel.get('/api/agent/estado', requirePanel, (req, res) => {
    const id = Number(req.query.id);
    const m = one('SELECT * FROM missions WHERE id=?', id);
    if (!m) return res.json({ ok: false });
    res.json({ ok: true, mission: m,
      steps: all('SELECT * FROM steps WHERE mission_id=? ORDER BY id ASC', id).map(s => Object.assign({}, s, { args: pj(s.args) })) });
  });
  panel.get('/api/ai/modelos', requirePanel, async (req, res) => {
    try {
      const r = await fetch('https://api.venice.ai/api/v1/models', { headers: { Authorization: 'Bearer ' + AI.key } });
      const d = await r.json();
      res.json({ ok: true, actual: AI.model,
        modelos: (d.data || []).filter(m => m.capabilities && m.capabilities.supportsVision).map(m => m.id) });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });
  panel.post('/api/ai/modelo', requirePanel, (req, res) => {
    AI.model = String((req.body || {}).modelo || AI.model);
    q('INSERT OR REPLACE INTO kv (k,v) VALUES (?,?)', 'ai_model', AI.model);
    res.json({ ok: true, modelo: AI.model });
  });
};
