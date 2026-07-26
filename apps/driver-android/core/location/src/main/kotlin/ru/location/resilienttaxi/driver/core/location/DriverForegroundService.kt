package ru.location.resilienttaxi.driver.core.location

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

class DriverForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        createNotificationChannel()
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat
                .Builder(this, CHANNEL_ID)
                .setContentTitle("Resilient Taxi Driver")
                .setContentText("Сервис статуса водителя активен")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .build(),
        )
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Driver status", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private companion object {
        const val CHANNEL_ID = "driver_status"
        const val NOTIFICATION_ID = 1001
    }
}
