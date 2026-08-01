package ru.location.resilienttaxi.driver.core.push

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Only invoked by the system when the app is in the foreground (a
 * combined notification+data FCM message auto-displays via the system
 * tray using `android.notification.channel_id` when the app is
 * backgrounded/killed — see firebase-push.provider.ts's platformConfig).
 * So this class only needs to build+show the notification for the
 * foreground case; the background case is handled by FCM/the OS using the
 * channel this app registered at startup (see PushNotificationChannel).
 */
@AndroidEntryPoint
class DriverFirebaseMessagingService : FirebaseMessagingService() {
    @Inject lateinit var registrar: PushTokenRegistrar

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onNewToken(token: String) {
        serviceScope.launch { registrar.registerOrRefresh() }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        val payload = PushDataPayload.parse(message.data)
        val channel = PushNotificationChannel.byId(payload?.type?.let(::categoryHintFrom))

        NotificationManagerCompat.from(this).notify(
            notificationId(payload?.notificationId),
            NotificationCompat
                .Builder(this, channel.id)
                .setContentTitle(notification.title)
                .setContentText(notification.body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
                .setContentIntent(contentIntent(payload))
                .build(),
        )
    }

    /**
     * Resolved via an implicit ACTION_VIEW intent rather than a direct
     * reference to MainActivity — this module can't depend on :app (:app
     * depends on it), and letting the system resolve the deep link's
     * intent-filter (declared on MainActivity in the app manifest) is the
     * normal way a library hands off a deep link anyway. Falls back to the
     * app's own launcher intent when there's no deepLink to route with.
     */
    private fun contentIntent(payload: PushDataPayload?): PendingIntent {
        val intent =
            payload?.deepLink?.let { Intent(Intent.ACTION_VIEW, Uri.parse(it)) }
                ?: packageManager.getLaunchIntentForPackage(packageName)
                ?: Intent()
        intent.setPackage(packageName)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** notificationId is a UUID, not usable directly as Android's int notification id — its hash is stable per notification, which is what dedup/replace needs. */
    private fun notificationId(notificationId: String?): Int = notificationId?.hashCode() ?: System.currentTimeMillis().toInt()

    companion object {
        /**
         * The server doesn't send category directly in the `data` block
         * (only `type`) — categories are a small fixed set derived from
         * type server-side (see NotificationTemplateService.categoryFor).
         * Mirrored here rather than trusting an extra wire field, so a
         * malformed/missing mapping can never smuggle in an unexpected
         * channel choice.
         */
        private val CATEGORY_BY_TYPE_PREFIX =
            mapOf(
                "DRIVER_NEW_TRIP_AVAILABLE" to PushNotificationChannel.TRIP_OFFERS.id,
                "DRIVER_BID_ACCEPTED" to PushNotificationChannel.ACTIVE_TRIP.id,
                "DRIVER_BID_REJECTED" to PushNotificationChannel.ACTIVE_TRIP.id,
                "DRIVER_TRIP_CANCELLED" to PushNotificationChannel.ACTIVE_TRIP.id,
                "DRIVER_PAYMENT_RESERVED" to PushNotificationChannel.ACTIVE_TRIP.id,
                "DRIVER_PICKUP_REMINDER" to PushNotificationChannel.ACTIVE_TRIP.id,
                "DRIVER_LOCATION_DEGRADED" to PushNotificationChannel.DRIVER_OPERATIONS.id,
                "DRIVER_DOCUMENT_EXPIRING" to PushNotificationChannel.DRIVER_OPERATIONS.id,
                "DRIVER_ACCOUNT_APPROVED" to PushNotificationChannel.DRIVER_OPERATIONS.id,
                "DRIVER_ACCOUNT_REJECTED" to PushNotificationChannel.DRIVER_OPERATIONS.id,
                "DRIVER_PAYOUT_COMPLETED" to PushNotificationChannel.PAYMENTS.id,
                "DRIVER_PAYOUT_FAILED" to PushNotificationChannel.PAYMENTS.id,
                "SECURITY_SESSION_REVOKED" to PushNotificationChannel.SECURITY.id,
                "SYSTEM_SERVICE_NOTICE" to PushNotificationChannel.ACCOUNT.id,
            )

        private fun categoryHintFrom(type: String): String? = CATEGORY_BY_TYPE_PREFIX[type]
    }
}
