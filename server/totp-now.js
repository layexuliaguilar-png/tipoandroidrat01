'use strict';
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32d(s) {
  s = String(s).replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, val = 0, i = 0; const out = Buffer.alloc(64);
  for (const c of s) { const k = B32.indexOf(c); if (k < 0) continue; val = (val << 5) | k; bits += 5;
    if (bits >= 8) { out[i++] = (val >>> (bits - 8)) & 0xff; bits -= 8; } }
  return out.subarray(0, i);
}
function code(secret, t = Date.now()) {
  const c = Math.floor(t / 1000 / 30), buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(c / 4294967296), 0); buf.writeUInt32BE(c >>> 0, 4);
  const h = crypto.createHmac('sha1', b32d(secret)).update(buf).digest();
  const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
const sec = process.argv[2] || process.env.PANEL_TOTP_SECRET;
if (!sec) {
  let s = ''; for (const x of crypto.randomBytes(20)) s += B32[x % 32];
  console.log('Secreto nuevo: ' + s); console.log('Codigo actual: ' + code(s));
} else {
  const t = Date.now();
  console.log('Codigo actual: ' + code(sec));
  console.log('Segundos restantes: ' + (30 - Math.floor(t / 1000) % 30));
}
