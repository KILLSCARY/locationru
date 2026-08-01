package ru.location.resilienttaxi.driver

import android.app.Application
import com.yandex.mapkit.MapKitFactory
import dagger.hilt.android.HiltAndroidApp
import ru.location.resilienttaxi.driver.core.push.PushNotificationChannel

@HiltAndroidApp
class DriverApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.MAPKIT_API_KEY.isNotBlank()) {
            MapKitFactory.setApiKey(BuildConfig.MAPKIT_API_KEY)
            MapKitFactory.initialize(this)
        }
        PushNotificationChannel.registerAll(this)
    }
}
