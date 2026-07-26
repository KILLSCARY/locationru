package ru.location.resilienttaxi.driver.core.location

import javax.inject.Inject

class LocationQualityEvaluator
    @Inject
    constructor() {
        fun evaluate(
            sample: LocationSample,
            gnssStatus: GnssStatusSnapshot,
            cellInfo: CellInfoSnapshot,
        ): EvaluatedLocation {
            val quality =
                when {
                    sample.accuracyMeters <= HIGH_ACCURACY_METERS &&
                        (gnssStatus.satellitesUsedInFix ?: 0) >= MIN_SATELLITES_FOR_HIGH -> LocationQuality.HIGH
                    sample.accuracyMeters <= MEDIUM_ACCURACY_METERS -> LocationQuality.MEDIUM
                    else -> LocationQuality.LOW
                }
            return EvaluatedLocation(
                sample = sample,
                quality = quality,
                suspectedSpoofing = sample.isMock || (sample.speedMetersPerSecond ?: 0f) > MAX_PLAUSIBLE_SPEED_MPS,
                satellitesVisible = gnssStatus.satellitesVisible,
                cellCount = cellInfo.cellCount,
            )
        }

        fun frequencyFor(
            state: DriverTrackingState,
            motion: MotionSnapshot,
            lastLocation: LocationSample? = null,
        ): TrackingFrequency =
            when {
                state.hasActiveTrip -> TrackingFrequency.ACTIVE_TRIP
                motion.isMoving || (lastLocation?.speedMetersPerSecond ?: 0f) >= MOVING_SPEED_MPS -> TrackingFrequency.MOVING
                else -> TrackingFrequency.IDLE
            }

        private companion object {
            const val HIGH_ACCURACY_METERS = 20f
            const val MEDIUM_ACCURACY_METERS = 60f
            const val MIN_SATELLITES_FOR_HIGH = 4
            const val MOVING_SPEED_MPS = 1f
            const val MAX_PLAUSIBLE_SPEED_MPS = 75f
        }
    }
