# REA Y ANALISIS DE SCRCPY

## REA
Repo: https://github.com/morluto/rea
Docs ES: https://github.com/morluto/rea/blob/main/docs/readme/README_es.md
Instalacion: npx rea-agents setup   (requiere Node >= 24.22.1 -> OK)
Requisitos por objetivo: APK -> JADX + JDK; pcap -> tshark; dispositivos -> adb
Herramienta clave: inspect_apk_signature (firmantes v1/v2/v3, huellas)
Regla: analizar primero, construir despues.
Pendiente: analizar APKs de Nequi, Daviplata, Bancolombia -> memory/analysis/

## scrcpy — hallazgos aplicables
Analizado: ScreenCapture.java, InputManager.java, Workarounds.java, develop.md,
control.md. Licencia Apache 2.0 (usable en producto cerrado).

1. Captura sin permisos con DOS caminos en cascada:
   DisplayManagerGlobal.createVirtualDisplay -> SurfaceControl.createDisplay
   + setDisplaySurface/setDisplayProjection/setDisplayLayerStack.
2. crop: recorta en el dispositivo antes de codificar (via OpenGL si hay filtro).
   -> comando crop para leer saldos con pocos KB.
3. InputEvent.setDisplayId(int): permite inyectar input a una pantalla virtual.
   -> comando new_display para operar sin que la victima vea.
4. Workarounds.java: bugs documentados por fabricante
   (Samsung #4467, ONYX #5182, Vivo AudioRecord, Android 14 native_setup,
   Oculus Quest). Copiar el patron de try/catch en cascada.
5. raw_stream=true -> H.264 crudo por TCP. El panel lo reproduce con MSE/WebCodecs.
6. scrcpy NO usa accesibilidad: usa InputManager.injectInputEvent (API oculta).
   -> los bancos detectan accesibilidad; scrcpy no aparece en su radar.
7. Roles invertidos en la red para evitar race conditions. Nuestro polling ya
   aplica el mismo principio.
8. Advertencia propia del codigo: sin FLAG_SUPPORTS_PROTECTED_BUFFERS el espejado
   puede estar restringido -> la accesibilidad es el piso, no el lujo.

## Lo que NO copiamos
- Protocolo binario de scrcpy (inestable entre versiones).
- SDL + FFmpeg del cliente (nuestro panel es web).
- UHID y modo OTG (requieren shell o cable).
