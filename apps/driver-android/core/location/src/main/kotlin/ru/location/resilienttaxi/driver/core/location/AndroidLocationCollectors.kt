package ru.location.resilienttaxi.driver.core.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.GnssStatus
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import javax.inject.Inject

class FusedLocationCollector
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val client: FusedLocationProviderClient,
    ) : FusedLocationSource {
        @SuppressLint("MissingPermission")
        override fun locations(request: TrackingRequest): Flow<LocationSample> =
            callbackFlow {
                if (!LocationPermissionChecker.hasLocationPermission(context)) {
                    close(SecurityException("Fine location permission is required for tracking"))
                    return@callbackFlow
                }
                val callback =
                    object : LocationCallback() {
                        override fun onLocationResult(result: LocationResult) {
                            result.locations.forEach { location ->
                                trySend(
                                    LocationSample(
                                        recordedAtEpochMillis = location.time,
                                        latitude = location.latitude,
                                        longitude = location.longitude,
                                        accuracyMeters = location.accuracy,
                                        speedMetersPerSecond = location.takeIf { it.hasSpeed() }?.speed,
                                        bearingDegrees = location.takeIf { it.hasBearing() }?.bearing,
                                        altitudeMeters = location.takeIf { it.hasAltitude() }?.altitude,
                                        provider = location.provider ?: "fused",
                                        isMock =
                                            if (Build.VERSION.SDK_INT >=
                                                Build.VERSION_CODES.S
                                            ) {
                                                location.isMock
                                            } else {
                                                location.isFromMockProvider
                                            },
                                    ),
                                )
                            }
                        }
                    }
                val locationRequest =
                    LocationRequest
                        .Builder(Priority.PRIORITY_HIGH_ACCURACY, request.intervalMillis)
                        .setMinUpdateIntervalMillis(request.minIntervalMillis)
                        .build()
                runCatching { client.requestLocationUpdates(locationRequest, callback, context.mainLooper) }
                    .onFailure { close(it) }
                awaitClose { client.removeLocationUpdates(callback) }
            }
    }

class GnssStatusCollector
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val locationManager: LocationManager,
    ) : GnssStatusSource {
        @SuppressLint("MissingPermission")
        override fun statuses(): Flow<GnssStatusSnapshot> =
            callbackFlow {
                if (!LocationPermissionChecker.hasLocationPermission(context)) {
                    trySend(GnssStatusSnapshot())
                    close()
                    return@callbackFlow
                }
                val callback =
                    object : GnssStatus.Callback() {
                        override fun onSatelliteStatusChanged(status: GnssStatus) {
                            var used = 0
                            for (index in 0 until status.satelliteCount) {
                                if (status.usedInFix(index)) used++
                            }
                            trySend(GnssStatusSnapshot(status.satelliteCount, used))
                        }
                    }
                runCatching { locationManager.registerGnssStatusCallback(context.mainExecutor, callback) }
                    .onFailure {
                        trySend(GnssStatusSnapshot())
                        close()
                    }
                awaitClose { locationManager.unregisterGnssStatusCallback(callback) }
            }
    }

/** Raw GNSS measurement access is optional and intentionally falls back to an unavailable snapshot. */
class GnssMeasurementsCollector
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val locationManager: LocationManager,
    ) : GnssMeasurementsSource {
        override fun measurements(): Flow<GnssMeasurementsSnapshot> =
            callbackFlow {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !LocationPermissionChecker.hasLocationPermission(context)) {
                    trySend(GnssMeasurementsSnapshot(isAvailable = false))
                    close()
                    return@callbackFlow
                }
                val callback =
                    object : android.location.GnssMeasurementsEvent.Callback() {
                        override fun onGnssMeasurementsReceived(eventArgs: android.location.GnssMeasurementsEvent) {
                            trySend(GnssMeasurementsSnapshot(isAvailable = true, measurementCount = eventArgs.measurements.size))
                        }

                        override fun onStatusChanged(status: Int) {
                            if (status != STATUS_READY) trySend(GnssMeasurementsSnapshot(isAvailable = false))
                        }
                    }
                runCatching { locationManager.registerGnssMeasurementsCallback(context.mainExecutor, callback) }
                    .onFailure {
                        trySend(GnssMeasurementsSnapshot(isAvailable = false))
                        close()
                    }
                awaitClose { locationManager.unregisterGnssMeasurementsCallback(callback) }
            }

        private companion object {
            const val STATUS_READY = 1
        }
    }

class CellInfoCollector
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val telephonyManager: TelephonyManager,
    ) : CellInfoSource {
        @SuppressLint("MissingPermission")
        override suspend fun currentCellInfo(): CellInfoSnapshot =
            runCatching {
                if (!LocationPermissionChecker.hasLocationPermission(context)) return CellInfoSnapshot()
                val cells = telephonyManager.allCellInfo ?: return CellInfoSnapshot()
                CellInfoSnapshot(cellCount = cells.size, isAvailable = true)
            }.getOrDefault(CellInfoSnapshot())
    }

class MotionSensorCollector
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : MotionSensorSource {
        override fun motion(): Flow<MotionSnapshot> =
            callbackFlow {
                val manager = context.getSystemService(SensorManager::class.java)
                val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
                if (sensor == null) {
                    trySend(MotionSnapshot())
                    close()
                    return@callbackFlow
                }
                val listener =
                    object : SensorEventListener {
                        override fun onSensorChanged(event: SensorEvent) {
                            val magnitude = kotlin.math.sqrt(event.values.sumOf { (it * it).toDouble() }).toFloat()
                            val deviation = kotlin.math.abs(magnitude - SensorManager.GRAVITY_EARTH)
                            trySend(MotionSnapshot(isMoving = deviation > MOTION_THRESHOLD, confidence = deviation.coerceAtMost(1f)))
                        }

                        override fun onAccuracyChanged(
                            sensor: Sensor?,
                            accuracy: Int,
                        ) = Unit
                    }
                manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
                awaitClose { manager.unregisterListener(listener) }
            }

        private companion object {
            const val MOTION_THRESHOLD = 1.5f
        }
    }

object LocationPermissionChecker {
    fun hasLocationPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
}

class NetworkStateCollector
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : NetworkStateSource {
        private val manager = context.getSystemService(ConnectivityManager::class.java)

        override fun isConnected(): Boolean =
            manager.activeNetwork
                ?.let(manager::getNetworkCapabilities)
                ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

        override fun connectivityChanges(): Flow<Boolean> =
            callbackFlow {
                val callback =
                    object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) {
                            trySend(isConnected())
                        }

                        override fun onLost(network: Network) {
                            trySend(isConnected())
                        }
                    }
                trySend(isConnected())
                manager.registerDefaultNetworkCallback(callback)
                awaitClose { manager.unregisterNetworkCallback(callback) }
            }
    }
