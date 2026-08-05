package ru.location.resilienttaxi.driver.core.network

import android.content.Context
import android.provider.Settings
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The single source of truth for "this physical device/install", used both
 * for OTP request/verify calls and for push-token registration — the same
 * identifier the backend already correlates auth and push device rows by
 * being consistent across both.
 */
@Singleton
class DeviceIdProvider
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) {
        fun deviceId(): String {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            return if (androidId.isNullOrBlank()) "android-device" else androidId
        }
    }
