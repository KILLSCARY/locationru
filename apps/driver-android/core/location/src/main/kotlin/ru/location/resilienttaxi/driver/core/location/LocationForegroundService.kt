package ru.location.resilienttaxi.driver.core.location

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class LocationForegroundService : Service() {
    @Inject lateinit var engine: LocationTrackingEngine

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val state =
            DriverTrackingState(
                isOnline = intent?.getBooleanExtra(EXTRA_IS_ONLINE, false) ?: false,
                hasActiveTrip = intent?.getBooleanExtra(EXTRA_HAS_ACTIVE_TRIP, false) ?: false,
            )
        if (!state.shouldTrack || !LocationPermissionChecker.hasLocationPermission(this)) {
            stopTracking()
            return START_NOT_STICKY
        }
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, notification())
        engine.start(state)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        serviceScope.launch { engine.stop() }
        super.onDestroy()
    }

    private fun stopTracking() {
        serviceScope.launch { engine.stop() }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notification() =
        NotificationCompat
            .Builder(this, CHANNEL_ID)
            .setContentTitle("Resilient Taxi Driver")
            .setContentText("Отправка геопозиции включена")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()

    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Driver location", NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        private const val ACTION_START = "ru.location.resilienttaxi.driver.location.START"
        private const val ACTION_STOP = "ru.location.resilienttaxi.driver.location.STOP"
        private const val EXTRA_IS_ONLINE = "is_online"
        private const val EXTRA_HAS_ACTIVE_TRIP = "has_active_trip"
        private const val CHANNEL_ID = "driver_location"
        private const val NOTIFICATION_ID = 1002

        fun start(
            context: Context,
            state: DriverTrackingState,
        ) {
            if (!state.shouldTrack || !LocationPermissionChecker.hasLocationPermission(context)) return
            val intent =
                Intent(context, LocationForegroundService::class.java)
                    .setAction(ACTION_START)
                    .putExtra(EXTRA_IS_ONLINE, state.isOnline)
                    .putExtra(EXTRA_HAS_ACTIVE_TRIP, state.hasActiveTrip)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationForegroundService::class.java).setAction(ACTION_STOP))
        }
    }
}
