package ru.location.resilienttaxi.driver.core.maps

data class DriverLocationSample(
    val location: GeoPoint,
    val bearingDegrees: Double?,
    /** Epoch millis when the GPS fix was taken (server-reported recordedAt). */
    val recordedAtEpochMillis: Long,
)

data class InterpolatorOptions(
    /** Animation duration for a "normal" update, in ms (MAP_DRIVER_INTERPOLATION_MS). */
    val defaultDurationMs: Long = 1_000,
    /** Never animate longer than this, however large the gap between updates. */
    val maxDurationMs: Long = 5_000,
    /** A jump implying more speed than this (m/s) is rejected as implausible. */
    val maxPlausibleSpeedMetersPerSecond: Double = 55.0,
)

enum class IngestOutcome {
    ACCEPTED,
    STALE_IGNORED,
    IMPLAUSIBLE_SPEED_IGNORED,
}

data class RenderedPosition(
    val location: GeoPoint,
    val bearingDegrees: Double?,
)

private data class Keyframe(
    val location: GeoPoint,
    val bearingDegrees: Double?,
    val recordedAtEpochMillis: Long,
)

/**
 * Smooths driver marker updates so the marker glides between GPS fixes
 * instead of teleporting on every location update. A sample older than (or
 * equal to) the current target's recordedAt never moves the marker backward
 * without cause, and a sample implying an impossible speed is rejected
 * outright.
 *
 * Callers ingest server updates via [ingest], then sample the interpolated
 * render position on every render tick via [positionAt] — the wall-clock time
 * is always caller-supplied, so this class has no hidden clock dependency and
 * is fully deterministic in tests.
 */
class DriverMarkerInterpolator(
    private val options: InterpolatorOptions = InterpolatorOptions(),
) {
    private var from: Keyframe? = null
    private var to: Keyframe? = null
    private var animStartMs: Long = 0
    private var animDurationMs: Long = 0

    fun ingest(
        sample: DriverLocationSample,
        receivedAtMs: Long,
    ): IngestOutcome {
        val currentTo = to

        if (currentTo != null && sample.recordedAtEpochMillis <= currentTo.recordedAtEpochMillis) {
            return IngestOutcome.STALE_IGNORED
        }

        if (currentTo != null) {
            val elapsedSeconds = (sample.recordedAtEpochMillis - currentTo.recordedAtEpochMillis) / 1000.0
            val distanceMeters = haversineMeters(currentTo.location, sample.location)
            val impliedSpeed = if (elapsedSeconds > 0) distanceMeters / elapsedSeconds else Double.POSITIVE_INFINITY
            if (impliedSpeed > options.maxPlausibleSpeedMetersPerSecond) {
                return IngestOutcome.IMPLAUSIBLE_SPEED_IGNORED
            }
        }

        // The new animation starts from wherever the marker currently sits, so
        // a fast-arriving update never causes a visible snap back to `to`.
        from =
            if (currentTo != null) {
                val rendered = positionAt(receivedAtMs)
                Keyframe(rendered.location, rendered.bearingDegrees, currentTo.recordedAtEpochMillis)
            } else {
                Keyframe(sample.location, sample.bearingDegrees, sample.recordedAtEpochMillis)
            }

        val previousRecordedAtMs = currentTo?.recordedAtEpochMillis ?: sample.recordedAtEpochMillis
        val gapMs = sample.recordedAtEpochMillis - previousRecordedAtMs
        animDurationMs = if (gapMs > 0) minOf(gapMs, options.maxDurationMs) else options.defaultDurationMs
        animStartMs = receivedAtMs
        to = Keyframe(sample.location, sample.bearingDegrees, sample.recordedAtEpochMillis)

        return IngestOutcome.ACCEPTED
    }

    /** The interpolated position to render at wall-clock time `nowMs`. */
    fun positionAt(nowMs: Long): RenderedPosition {
        val currentTo = to ?: return RenderedPosition(GeoPoint(0.0, 0.0), null)
        val currentFrom = from ?: return RenderedPosition(currentTo.location, currentTo.bearingDegrees)

        val t =
            if (animDurationMs <= 0) {
                1.0
            } else {
                ((nowMs - animStartMs).toDouble() / animDurationMs).coerceIn(0.0, 1.0)
            }

        return RenderedPosition(
            location = lerpPoint(currentFrom.location, currentTo.location, t),
            bearingDegrees = lerpBearing(currentFrom.bearingDegrees, currentTo.bearingDegrees, t),
        )
    }

    /** True once at least one sample has been accepted. */
    fun hasPosition(): Boolean = to != null
}
