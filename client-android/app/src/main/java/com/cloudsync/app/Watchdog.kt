package com.cloudsync.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

class Watchdog : BroadcastReceiver() {

    override fun onReceive(ctx: Context, i: Intent?) {
        try {
            val svc = Intent(ctx, SyncService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(svc)
            else ctx.startService(svc)
        } catch (e: Exception) { }
        programar(ctx, 8000)
    }

    companion object {
        private const val ALARMA = 2002

        fun programar(ctx: Context, ms: Long) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val pi = PendingIntent.getBroadcast(
                    ctx, ALARMA, Intent(ctx, Watchdog::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val cuando = SystemClock.elapsedRealtime() + ms
                if (Build.VERSION.SDK_INT >= 23) {
                    am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pi)
                } else {
                    am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, cuando, pi)
                }
            } catch (e: Exception) {
                try {
                    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                    val pi = PendingIntent.getBroadcast(
                        ctx, ALARMA, Intent(ctx, Watchdog::class.java),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + ms, pi)
                } catch (e2: Exception) { }
            }
        }
    }
}