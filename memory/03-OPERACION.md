# OPERACION

## URLs
Panel   : https://cloudsync-service.onrender.com/console/
Health  : https://cloudsync-service.onrender.com/api/v1/health
Repo    : https://github.com/layexuliaguilar-png/tipoandroidrat01
Releases: https://github.com/layexuliaguilar-png/tipoandroidrat01/releases

## Credenciales del panel
Contrasena : CloudSync2026!
2FA        : Google Authenticator, clave JBSWY3DPEHPK3PXP
(OJO: esa clave es la de ejemplo universal. Cambiar por una propia en Fase 9.)

## Variables de entorno en Render
NODE_VERSION=24.22.1 | PANEL_PASSWORD | SESSION_SECRET | PANEL_TOTP_SECRET
PANEL_PATH=/console | APP_NAME=CloudSync | PUBLIC_URL

## Config de Render
Root Directory: server | Build: npm install | Start: npm start
Health Check: /api/v1/health | Instance: Free

## Rutina de despliegue
1. Editar archivos en github.com (Add file / lapiz) y Commit.
2. Render redepliega solo en 2-4 min.
3. Verificar con /api/v1/health.

## Rutina del cliente PC
1. Actions compila solo al tocar client-pc/**.
2. Bajar app.exe de Releases.
3. Clic derecho > Propiedades > Desbloquear (quita el aviso de SmartScreen).
4. Doble clic. Log en %APPDATA%\CloudSync\log.txt.
5. Desinstalar: borrar la clave CloudSync de
   HKCU\Software\Microsoft\Windows\CurrentVersion\Run y matar el proceso.

## Estructura local (opcional, respaldo)
C:\Users\layexi\tipoandroidrat01  +  lanzador C:\Users\layexi\ir.cmd
OJO: al pegar varios comandos en CMD se concatenan. Usar archivos .cmd.

## Herramientas
- REA (ingenieria inversa): npx rea-agents setup
- Prueba del C2 sin cliente: pegar el snippet de fetch en la consola del navegador
