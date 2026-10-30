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
      dev, cmd, j


[System.IO.File]::WriteAllText("$REPO\server\public\agente-ui.js", @'
(function () {
  const devui = document.getElementById('devui');
  if (!devui) return;
  devui.insertAdjacentHTML('afterbegin', `
  <div class="card">
    <h3>Agente IA</h3>
    <input id="aorden" placeholder="orden en espanol (ej: abre Nequi y dime el saldo)" style="margin:0">
    <div class="row" style="margin-top:8px">
      <select id="amodo" style="width:auto;margin:0">
        <option value="hibrido">hibrido (pide OK antes de confirmar)</option>
        <option value="auto">automatico</option>
        <option value="copiloto">copiloto (paso a paso)</option>
      </select>
      <button class="g" onclick="agenteIniciar()">ARRANCAR</button>
      <button onclick="agenteContinuar()">CONTINUAR</button>
      <button class="d" onclick="agenteParar()">PARAR</button>
      <span class="kv" id="aestado"></span>
    </div>
    <div class="row" style="margin-top:8px">
      <input id="amodelo" placeholder="modelo de vision" style="flex:1;margin:0">
      <button onclick="guardarModelo()">Guardar modelo</button>
      <button onclick="verModelos()">Ver modelos</button>
    </div>
    <div id="acinta" class="scroll" style="margin-top:8px;max-height:440px"></div>
  </div>`);

  let AG = null, t = null;
  window.agenteIniciar = async function () {
    const o = document.getElementById('aorden').value.trim();
    if (!o) return;
    const d = await api('/api/agent/iniciar', { method: 'POST',
      body: JSON.stringify({ device_id: DEV, orden: o, modo: document.getElementById('amodo').value }) });
    if (!d.ok) { document.getElementById('aestado').textContent = 'error: ' + (d.error || '?'); return; }
    AG = d.id; clearInterval(t); t = setInterval(agentePoll, 2000); agentePoll();
  };
  window.agenteParar = async function () { if (AG) await api('/api/agent/parar', { method: 'POST', body: JSON.stringify({ id: AG }) }); };
  window.agenteContinuar = async function () { if (AG) await api('/api/agent/continuar', { method: 'POST', body: JSON.stringify({ id: AG }) }); };
  window.guardarModelo = async function () {
    const mo = document.getElementById('amodelo').value.trim();
    if (!mo) return;
    await api('/api/ai/modelo', { method: 'POST', body: JSON.stringify({ modelo: mo }) });
    document.getElementById('aestado').textContent = 'modelo: ' + mo;
  };
  window.verModelos = async function () {
    const d = await api('/api/ai/modelos');
    document.getElementById('acinta').innerHTML = '<div class="kv">' + (d.ok ? d.modelos.join('<br>') : d.error) + '</div>';
  };
  async function agentePoll() {
    if (!AG) return;
    const d = await api('/api/agent/estado?id=' + AG);
    if (!d.ok) return;
    const m = d.mission;
    document.getElementById('aestado').textContent = m.estado + ' - paso ' + (m.pasos || 0);
    if (m.estado !== 'corriendo' && m.estado !== 'esperando') { clearInterval(t); t = null; }
    document.getElementById('acinta').innerHTML = d.steps.map(s => {
      let h = '<div style="border-bottom:1px solid var(--line);padding:6px 0">';
      h += '<div class="kv">paso ' + s.n + ' - ' + esc(s.accion) +
           (s.args && s.args.texto ? ' - "' + esc(s.args.texto) + '"' : '') + ' - ' +
           (s.ok === 1 ? 'ok' : s.ok === 0 ? 'ERROR' : 'pendiente') + '</div>';
      if (s.pensamiento) h += '<div class="mono" style="color:#9fb3c8">' + esc(s.pensamiento) + '</div>';
      if (s.resultado) h += '<div class="mono y">' + esc(String(s.resultado).slice(0, 260)) + '</div>';
      if (s.shot_id) h += '<img src="' + BASE + '/shot/' + s.shot_id +
        '" style="width:130px;border:1px solid var(--line);border-radius:5px;margin-top:4px;cursor:pointer" onclick="zoom(this.src,0,0)">';
      return h + '</div>';
    }).join('');
  }
})();