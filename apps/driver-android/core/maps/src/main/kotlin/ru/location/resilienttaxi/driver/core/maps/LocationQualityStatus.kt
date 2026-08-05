package ru.location.resilienttaxi.driver.core.maps

enum class LocationQualityStatus {
    STABLE,
    DEGRADED,
    STALE,
    SPOOFING_SUSPECTED,
    UNAVAILABLE,
}

data class LocationQualitySample(
    val location: GeoPoint,
    val accuracyMeters: Double,
    /** Epoch millis when the GPS fix was taken. */
    val recordedAtEpochMillis: Long,
)

data class LocationQualityThresholds(
    val staleAfterSeconds: Long = 15,
    val unavailableAfterSeconds: Long = 60,
    val degradedAccuracyMeters: Double = 50.0,
    val maxPlausibleSpeedMetersPerSecond: Double = 55.0, // ~200 km/h
)

data class LocationQualityResult(
    val status: LocationQualityStatus,
    val ageSeconds: Double,
    val impliedSpeedMetersPerSecond: Double?,
)

/**
 * Classifies a location sample for map rendering — distinct from the driver's
 * own upload-time accuracy classification ([ru.location.resilienttaxi.driver.core.location.LocationQuality],
 * LOW/MEDIUM/HIGH): this axis is about how much a *consumer* of the sample
 * (the driver's own screen, or a passenger watching this driver) should trust
 * it right now, given its age and its movement relative to the last
 * known-good sample.
 */
fun classifyLocationQuality(
    sample: LocationQualitySample,
    previous: LocationQualitySample?,
    nowEpochMillis: Long,
    thresholds: LocationQualityThresholds = LocationQualityThresholds(),
): LocationQualityResult {
    val ageSeconds = ((nowEpochMillis - sample.recordedAtEpochMillis) / 1000.0).coerceAtLeast(0.0)

    if (ageSeconds > thresholds.unavailableAfterSeconds) {
        return LocationQualityResult(LocationQualityStatus.UNAVAILABLE, ageSeconds, null)
    }
    if (ageSeconds > thresholds.staleAfterSeconds) {
        return LocationQualityResult(LocationQualityStatus.STALE, ageSeconds, null)
    }

    val impliedSpeed = impliedSpeedMetersPerSecond(sample, previous)
    if (impliedSpeed != null && impliedSpeed > thresholds.maxPlausibleSpeedMetersPerSecond) {
        return LocationQualityResult(LocationQualityStatus.SPOOFING_SUSPECTED, ageSeconds, impliedSpeed)
    }

    if (sample.accuracyMeters > thresholds.degradedAccuracyMeters) {
        return LocationQualityResult(LocationQualityStatus.DEGRADED, ageSeconds, impliedSpeed)
    }

    return LocationQualityResult(LocationQualityStatus.STABLE, ageSeconds, impliedSpeed)
}

private fun impliedSpeedMetersPerSecond(
    sample: LocationQualitySample,
    previous: LocationQualitySample?,
): Double? {
    if (previous == null) return null
    val elapsedSeconds = (sample.recordedAtEpochMillis - previous.recordedAtEpochMillis) / 1000.0
    if (elapsedSeconds <= 0) return null
    return haversineMeters(previous.location, sample.location) / elapsedSeconds
}

fun driverMessageFor(status: LocationQualityStatus): String? =
    when (status) {
        LocationQualityStatus.STABLE -> null
        LocationQualityStatus.DEGRADED -> "Слабый сигнал геолокации — точность снижена."
        LocationQualityStatus.STALE -> "Нет свежих данных геолокации."
        LocationQualityStatus.SPOOFING_SUSPECTED -> "Похоже на подмену геолокации — координаты не используются."
        LocationQualityStatus.UNAVAILABLE -> "Геолокация недоступна."
    }
