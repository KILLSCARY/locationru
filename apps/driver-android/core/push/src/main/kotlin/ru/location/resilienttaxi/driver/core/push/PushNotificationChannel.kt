package ru.location.resilienttaxi.driver.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * One Android notification channel per backend NotificationCategory — ids
 * must stay in sync with ANDROID_CHANNEL_BY_CATEGORY in
 * firebase-push.provider.ts, since that's what FCM's
 * `android.notification.channel_id` field references for a
 * background/killed-app delivery (the system, not our code, picks the
 * channel in that case). Importance here governs whether a category can
 * interrupt the user (heads-up + sound) or stays silent in the shade.
 */
enum class PushNotificationChannel(
    val id: String,
    val displayName: String,
    val description: String,
    val importance: Int,
) {
    TRIP_OFFERS(
        id = "trip_offers",
        displayName = "Новые заказы",
        description = "Предложения новых поездок поблизости",
        importance = NotificationManager.IMPORTANCE_HIGH,
    ),
    ACTIVE_TRIP(
        id = "active_trip",
        displayName = "Текущая поездка",
        description = "Изменения статуса активной поездки",
        importance = NotificationManager.IMPORTANCE_HIGH,
    ),
    PAYMENTS(
        id = "payments",
        displayName = "Выплаты",
        description = "Статус выплат и удержаний",
        importance = NotificationManager.IMPORTANCE_DEFAULT,
    ),
    DRIVER_OPERATIONS(
        id = "driver_operations",
        displayName = "Документы и аккаунт водителя",
        description = "Проверка документов, истечение сроков",
        importance = NotificationManager.IMPORTANCE_DEFAULT,
    ),
    ACCOUNT(
        id = "account",
        displayName = "Аккаунт",
        description = "Общие уведомления сервиса",
        importance = NotificationManager.IMPORTANCE_DEFAULT,
    ),
    SECURITY(
        id = "security",
        displayName = "Безопасность",
        description = "Вход в аккаунт и изменения безопасности",
        importance = NotificationManager.IMPORTANCE_HIGH,
    ),
    ;

    companion object {
        /** Registers every channel exactly once (idempotent — re-creating an unchanged channel is a no-op). Call from Application.onCreate. */
        fun registerAll(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            entries.forEach { channel ->
                manager.createNotificationChannel(
                    NotificationChannel(channel.id, channel.displayName, channel.importance).apply {
                        description = channel.description
                    },
                )
            }
        }

        /** Falls back to ACCOUNT for an unrecognized/future category rather than crashing on a channel id the app doesn't know yet. */
        fun byId(id: String?): PushNotificationChannel = entries.find { it.id == id } ?: ACCOUNT
    }
}
