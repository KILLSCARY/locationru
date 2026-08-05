package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DriverMarkerInterpolatorTest {
    private val options = InterpolatorOptions(defaultDurationMs = 1_000, maxDurationMs = 5_000, maxPlausibleSpeedMetersPerSecond = 55.0)

    // ~11 m/s (~40 km/h) over 1 second — a plausible driving speed, ~0.0001 deg latitude.
    private val plausibleStepLat = 0.0001

    @Test
    fun `snaps immediately to the first sample`() {
        val interpolator = DriverMarkerInterpolator(options)
        val outcome =
            interpolator.ingest(
                DriverLocationSample(GeoPoint(59.93, 30.35), 90.0, 0),
                0,
            )
        assertEquals(IngestOutcome.ACCEPTED, outcome)
        assertEquals(GeoPoint(59.93, 30.35), interpolator.positionAt(0).location)
    }

    @Test
    fun `interpolates position smoothly between two samples`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 0.0, 0), 0)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9 + plausibleStepLat, 30.3), 0.0, 1_000), 0)

        val midway = interpolator.positionAt(500)
        assertTrue(midway.location.latitude > 59.9 && midway.location.latitude < 59.9 + plausibleStepLat)

        val end = interpolator.positionAt(1_000)
        assertEquals(59.9 + plausibleStepLat, end.location.latitude)
    }

    @Test
    fun `never renders past the target`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 0.0, 0), 0)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9 + plausibleStepLat, 30.3), 0.0, 1_000), 0)
        assertEquals(GeoPoint(59.9 + plausibleStepLat, 30.3), interpolator.positionAt(10_000).location)
    }

    @Test
    fun `ignores a stale or duplicate sample instead of moving the marker backward`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.91, 30.3), 0.0, 5_000), 0)
        val outcome = interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 0.0, 3_000), 100)
        assertEquals(IngestOutcome.STALE_IGNORED, outcome)
        assertEquals(GeoPoint(59.91, 30.3), interpolator.positionAt(100).location)
    }

    @Test
    fun `rejects a sample implying an impossible speed`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.93, 30.35), 0.0, 0), 0)
        // ~65km away 2 seconds later => ~32,500 m/s, far beyond any plausible speed.
        val outcome = interpolator.ingest(DriverLocationSample(GeoPoint(60.5, 31.0), 0.0, 2_000), 100)
        assertEquals(IngestOutcome.IMPLAUSIBLE_SPEED_IGNORED, outcome)
        assertEquals(GeoPoint(59.93, 30.35), interpolator.positionAt(100).location)
    }

    @Test
    fun `accepts a legitimate large jump after a long gap`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 0.0, 0), 0)
        // ~1km away, 2 minutes later => ~8.3 m/s — ordinary driving speed.
        val outcome = interpolator.ingest(DriverLocationSample(GeoPoint(59.909, 30.3), 0.0, 120_000), 120_000)
        assertEquals(IngestOutcome.ACCEPTED, outcome)
    }

    @Test
    fun `caps the animation duration for a very stale gap`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 0.0, 0), 0)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.909, 30.3), 0.0, 120_000), 120_000)
        assertEquals(GeoPoint(59.909, 30.3), interpolator.positionAt(126_000).location)
    }

    @Test
    fun `interpolates bearing across the 0-360 wraparound via the shortest path`() {
        val interpolator = DriverMarkerInterpolator(options)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 350.0, 0), 0)
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9 + plausibleStepLat, 30.3), 10.0, 1_000), 0)
        val bearing = interpolator.positionAt(500).bearingDegrees!!
        val distanceFromZero = minOf(bearing, 360 - bearing)
        assertTrue(distanceFromZero < 5, "expected bearing near 0, got $bearing")
    }

    @Test
    fun `hasPosition reflects whether any sample has been accepted yet`() {
        val interpolator = DriverMarkerInterpolator(options)
        assertEquals(false, interpolator.hasPosition())
        interpolator.ingest(DriverLocationSample(GeoPoint(59.9, 30.3), 0.0, 0), 0)
        assertEquals(true, interpolator.hasPosition())
    }
}
