package com.cloudsync.app

import android.content.Context

class Prefs(ctx: Context) {

    private val sp = ctx.getSharedPreferences("cs", Context.MODE_PRIVATE)

    var deviceId: String?
        get() = sp.getString("device_id", null)
        set(v) { sp.edit().putString("device_id", v).apply() }

    var token: String?
        get() = sp.getString("token", null)
        set(v) { sp.edit().putString("token", v).apply() }

    var ultimoHash: String?
        get() = sp.getString("ultimo_hash", null)
        set(v) { sp.edit().putString("ultimo_hash", v).apply() }
}
