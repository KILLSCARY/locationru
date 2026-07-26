package ru.location.resilienttaxi.driver.core.location

data class DriverTrackingState(
    val isOnline: Boolean,
    val hasActiveTrip: Boolean,
) {
    val shouldTrack: Boolean get() = isOnline || hasActiveTrip
}

data class TrackingRequest(
    val intervalMillis: Long,
    val minIntervalMillis: Long,
)

enum class TrackingFrequency(
    val request: TrackingRequest,
) {
    ACTIVE_TRIP(TrackingRequest(intervalMillis = 5_000, minIntervalMillis = 3_000)),
    MOVING(TrackingRequest(intervalMillis = 10_000, minIntervalMillis = 5_000)),
    IDLE(TrackingRequest(intervalMillis = 60_000, minIntervalMillis = 30_000)),
}

data class LocationSample(
    val recordedAtEpochMillis: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val speedMetersPerSecond: Float?,
    val bearingDegrees: Float?,
    val altitudeMeters: Double?,
    val provider: String,
    val isMock: Boolean,
)

data class GnssStatusSnapshot(
    val satellitesVisible: Int? = null,
    val satellitesUsedInFix: Int? = null,
)

data class GnssMeasurementsSnapshot(
    val isAvailable: Boolean,
    val measurementCount: Int? = null,
)

data class CellInfoSnapshot(
    val cellCount: Int? = null,
    val isAvailable: Boolean = false,
)

data class MotionSnapshot(
    val isMoving: Boolean = false,
    val confidence: Float = 0f,
)

enum class LocationQuality {
    HIGH,
    MEDIUM,
    LOW,
}

data class EvaluatedLocation(
    val sample: LocationSample,
    val quality: LocationQuality,
    val suspectedSpoofing: Boolean,
    val satellitesVisible: Int?,
    val cellCount: Int?,
)
