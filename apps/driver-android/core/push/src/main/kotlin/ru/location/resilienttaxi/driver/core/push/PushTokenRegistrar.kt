package ru.location.resilienttaxi.driver.core.push

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import ru.location.resilienttaxi.driver.core.network.DeviceIdProvider
import ru.location.resilienttaxi.driver.core.network.DriverApi
import ru.location.resilienttaxi.driver.core.network.RegisterDeviceTokenRequest
import ru.location.resilienttaxi.driver.domain.TokenStorage
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

private const val PREFERENCES = "push_registration"
private const val KEY_DEVICE_TOKEN_ID = "device_token_id"

/**
 * Registers/re-registers this device's FCM token with the backend
 * (`POST /notifications/devices` — `refreshDevice` on the server is
 * identical to `registerDevice`, so there's no separate "first time vs
 * refresh" call to choose between here) and revokes it on sign-out.
 * Every failure is swallowed — push registration must never block or
 * break the login/session flow it's called from.
 */
@Singleton
class PushTokenRegistrar
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val api: DriverApi,
        private val tokenStorage: TokenStorage,
        private val deviceIdProvider: DeviceIdProvider,
    ) {
        suspend fun registerOrRefresh() {
            if (tokenStorage.read() == null) return
            val rawToken = fetchFcmToken() ?: return
            runCatching {
                api.registerDeviceToken(
                    RegisterDeviceTokenRequest(
                        deviceId = deviceIdProvider.deviceId(),
                        pushToken = rawToken,
                        notificationsPermission = hasNotificationsPermission(),
                    ),
                )
            }.onSuccess { response -> savePushTokenId(response.id) }
        }

        suspend fun revokeCurrent() {
            val id = readPushTokenId() ?: return
            runCatching { api.revokeDeviceToken(id) }
            clearPushTokenId()
        }

        private fun hasNotificationsPermission(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

        private suspend fun fetchFcmToken(): String? =
            runCatching {
                suspendCancellableCoroutine { continuation ->
                    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        continuation.resume(if (task.isSuccessful) task.result else null)
                    }
                }
            }.getOrNull()

        private fun preferences() = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

        private fun savePushTokenId(id: String) {
            preferences().edit().putString(KEY_DEVICE_TOKEN_ID, id).apply()
        }

        private fun readPushTokenId(): String? = preferences().getString(KEY_DEVICE_TOKEN_ID, null)

        private fun clearPushTokenId() {
            preferences().edit().remove(KEY_DEVICE_TOKEN_ID).apply()
        }
    }
