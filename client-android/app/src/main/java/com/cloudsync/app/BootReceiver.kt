package com.cloudsync.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, i: Intent?) {
        try {
            val svc = Intent(ctx, SyncService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc)
            else ctx.startService(svc)
        } catch (e: Exception) { }
        Watchdog.programar(ctx, 15000)
    }
}