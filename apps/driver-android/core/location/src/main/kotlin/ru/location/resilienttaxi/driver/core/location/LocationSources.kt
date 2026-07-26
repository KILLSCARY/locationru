package ru.location.resilienttaxi.driver.core.location

import kotlinx.coroutines.flow.Flow

/** Interfaces keep device-specific Android sources replaceable in unit tests. */
interface FusedLocationSource {
    fun locations(request: TrackingRequest): Flow<LocationSample>
}

interface GnssStatusSource {
    fun statuses(): Flow<GnssStatusSnapshot>
}

interface GnssMeasurementsSource {
    fun measurements(): Flow<GnssMeasurementsSnapshot>
}

interface CellInfoSource {
    suspend fun currentCellInfo(): CellInfoSnapshot
}

interface MotionSensorSource {
    fun motion(): Flow<MotionSnapshot>
}

interface NetworkStateSource {
    fun isConnected(): Boolean

    fun connectivityChanges(): Flow<Boolean>
}
