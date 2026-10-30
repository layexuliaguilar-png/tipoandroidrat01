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
