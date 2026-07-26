package ru.location.resilienttaxi.driver.core.location

import android.content.Context
import android.location.LocationManager
import android.telephony.TelephonyManager
import com.google.android.gms.location.LocationServices
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object LocationModule {
    @Provides
    @Singleton
    fun provideFusedClient(
        @ApplicationContext context: Context,
    ) = LocationServices.getFusedLocationProviderClient(context)

    @Provides
    fun provideLocationManager(
        @ApplicationContext context: Context,
    ): LocationManager = context.getSystemService(LocationManager::class.java)

    @Provides
    fun provideTelephonyManager(
        @ApplicationContext context: Context,
    ): TelephonyManager = context.getSystemService(TelephonyManager::class.java)
}
