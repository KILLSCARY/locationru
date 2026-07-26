package ru.location.resilienttaxi.driver.core.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationQualityEvaluatorTest {
    private val evaluator = LocationQualityEvaluator()

    @Test
    fun `marks accurate GNSS fix as high quality`() {
        val result = evaluator.evaluate(sample(accuracyMeters = 8f), GnssStatusSnapshot(9, 6), CellInfoSnapshot(3, true))

        assertEquals(LocationQuality.HIGH, result.quality)
        assertEquals(3, result.cellCount)
        assertFalse(result.suspectedSpoofing)
    }

    @Test
    fun `uses medium quality without raw GNSS data`() {
        val result = evaluator.evaluate(sample(accuracyMeters = 35f), GnssStatusSnapshot(), CellInfoSnapshot())

        assertEquals(LocationQuality.MEDIUM, result.quality)
    }

    @Test
    fun `flags mock or implausibly fast location`() {
        val mock = evaluator.evaluate(sample(isMock = true), GnssStatusSnapshot(), CellInfoSnapshot())
        val fast = evaluator.evaluate(sample(speedMetersPerSecond = 80f), GnssStatusSnapshot(), CellInfoSnapshot())

        assertTrue(mock.suspectedSpoofing)
        assertTrue(fast.suspectedSpoofing)
    }

    @Test
    fun `selects an adaptive interval from trip and motion state`() {
        assertEquals(
            TrackingFrequency.ACTIVE_TRIP,
            evaluator.frequencyFor(DriverTrackingState(isOnline = true, hasActiveTrip = true), MotionSnapshot()),
        )
        assertEquals(
            TrackingFrequency.MOVING,
            evaluator.frequencyFor(DriverTrackingState(isOnline = true, hasActiveTrip = false), MotionSnapshot(isMoving = true)),
        )
        assertEquals(
            TrackingFrequency.IDLE,
            evaluator.frequencyFor(DriverTrackingState(isOnline = true, hasActiveTrip = false), MotionSnapshot()),
        )
    }

    private fun sample(
        accuracyMeters: Float = 100f,
        speedMetersPerSecond: Float? = null,
        isMock: Boolean = false,
    ) = LocationSample(
        recordedAtEpochMillis = 1,
        latitude = 55.75,
        longitude = 37.61,
        accuracyMeters = accuracyMeters,
        speedMetersPerSecond = speedMetersPerSecond,
        bearingDegrees = null,
        altitudeMeters = null,
        provider = "fused",
        isMock = isMock,
    )
}
