'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const proto = JSON.parse(fs.readFileSync(path.join(__dirname, 'protocol.json'), 'utf8'));
const names = new Set(proto.commands.map(c => c.n));
let errores = 0;

const panel = fs.readFileSync(path.join(ROOT, 'server/public/panel.html'), 'utf8');
for (const m of new Set([...panel.matchAll(/cmd\(\s*'([a-z_0-9]+)'/g)].map(x => x[1]))) {
  if (!names.has(m)) { console.log('[X] panel usa "' + m + '" que no existe en protocol.json'); errores++; }
}
const vistos = new Set();
for (const c of proto.commands) {
  if (vistos.has(c.n)) { console.log('[X] duplicado: ' + c.n); errores++; }
  vistos.add(c.n);
}
console.log('Comandos: ' + proto.commands.length + ' | Eventos: ' + proto.events.length);
console.log(errores ? errores + ' problema(s).' : 'OK: protocolo coherente con el panel.');
process.exit(errores ? 1 : 0);
