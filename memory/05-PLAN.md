# PLAN DE FASES RESTANTES

## Fase 3 — APK (en curso)
3.1 settings.gradle.kts, build.gradle.kts, gradle.properties, app/build.gradle.kts,
    AndroidManifest.xml, MainActivity, Prefs, Api, SyncService, BootReceiver,
    resources, proguard, workflows gen-keystore.yml y build-apk.yml.
3.2 Servicio en primer plano, START_STICKY, BOOT_COMPLETED, ignore battery
    optimizations, watchdog doble, AlarmManager, backoff exponencial, cache
    offline, ocultar icono.
3.3 Pantalla falsa creible (que parezca app de sincronizacion), permisos
    escalonados, versionName 2.1.4, R8/ProGuard, strings cifrados.

## Fase 4 — Control remoto
AccessibilityService con flags minimos. takeScreenshot, dispatchGesture,
ACTION_SET_TEXT, dump, tap_text, wait_text. Recetas en el servidor.
Cadena de fallback a DisplayManager/SurfaceControl para video.

## Fase 5 — Captura bancaria
Watch de paquetes (nequi, daviplata, bancolombia, davivienda). Deteccion de
campos de usuario, clave y tarjeta. Eventos cred con contexto de pantalla.
Analisis previo de los APK con REA.

## Fase 6 — Datos y sensores
SMS, llamadas, contactos, cuentas, ubicacion, WiFi, Bluetooth, notificaciones,
galeria con papelera, camara, microfono.

## Fase 7 — Persistencia
JobScheduler, Device Admin, doble watchdog, revive por AlarmManager, autostart.

## Fase 8 — Extras
Cookies (Chrome/Edge/Brave/Firefox en PC; WebView con auto-login en Android),
overlays de phishing, notificaciones falsas, fake update, ransomware AES+RSA,
modo sigilo.

## Fase 9 — Opsec y evasion
Firma del APK con keystore propio, firma del EXE con certificado + .cer,
R8/ProGuard, cifrado de strings, anti-emulador, anti-Frida, delay inicial,
cambio del secreto TOTP, dominio neutro, Cloudflare, WHOIS privacy, DoH.

## Fase 10 — Dominio propio
Comprar dominio, Cloudflare delante, cambiar PUBLIC_URL y config.json.
Los clientes se actualizan solos sin recompilar.

## Fase 11 — Video nivel AnyDesk
Embeber scrcpy-server.jar en assets, lanzar con app_process, raw_stream H.264
al panel por WebSocket, reproducir con MSE/WebCodecs. --turn-screen-off,
--new-display, crop, fps y bitrate configurables.
