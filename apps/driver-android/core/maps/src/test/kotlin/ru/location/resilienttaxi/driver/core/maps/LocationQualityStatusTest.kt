package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals

class LocationQualityStatusTest {
    private val base =
        LocationQualitySample(
            location = GeoPoint(59.93, 30.35),
            accuracyMeters = 10.0,
            recordedAtEpochMillis = 1_735_689_600_000L,
        )
    private val thresholds = LocationQualityThresholds()

    @Test
    fun `classifies a fresh accurate slow-moving sample as STABLE`() {
        val result = classifyLocationQuality(base, null, base.recordedAtEpochMillis)
        assertEquals(LocationQualityStatus.STABLE, result.status)
    }

    @Test
    fun `classifies a low-accuracy sample as DEGRADED`() {
        val result =
            classifyLocationQuality(base.copy(accuracyMeters = 80.0), null, base.recordedAtEpochMillis)
        assertEquals(LocationQualityStatus.DEGRADED, result.status)
    }

    @Test
    fun `classifies a sample older than staleAfterSeconds as STALE`() {
        val laterMs = base.recordedAtEpochMillis + (thresholds.staleAfterSeconds + 1) * 1_000
        val result = classifyLocationQuality(base, null, laterMs)
        assertEquals(LocationQualityStatus.STALE, result.status)
    }

    @Test
    fun `classifies a sample older than unavailableAfterSeconds as UNAVAILABLE`() {
        val laterMs = base.recordedAtEpochMillis + (thresholds.unavailableAfterSeconds + 1) * 1_000
        val result = classifyLocationQuality(base, null, laterMs)
        assertEquals(LocationQualityStatus.UNAVAILABLE, result.status)
    }

    @Test
    fun `classifies an impossible jump from the previous sample as SPOOFING_SUSPECTED`() {
        val previous = base
        val jumped =
            base.copy(
                location = GeoPoint(60.5, 31.0), // ~65km away
                recordedAtEpochMillis = base.recordedAtEpochMillis + 2_000, // 2 seconds later
            )
        val result = classifyLocationQuality(jumped, previous, jumped.recordedAtEpochMillis)
        assertEquals(LocationQualityStatus.SPOOFING_SUSPECTED, result.status)
    }

    @Test
    fun `does not flag a legitimate long gap as spoofing when average speed is plausible`() {
        val previous = base
        // ~1km away, 2 minutes later => ~8.3 m/s, well within plausible driving speed.
        val later =
            base.copy(
                location = GeoPoint(59.939, 30.35),
                recordedAtEpochMillis = base.recordedAtEpochMillis + 120_000,
            )
        val result = classifyLocationQuality(later, previous, later.recordedAtEpochMillis)
        assertEquals(LocationQualityStatus.STABLE, result.status)
    }

    @Test
    fun `staleness takes priority over spoofing and accuracy checks`() {
        val laterMs = base.recordedAtEpochMillis + (thresholds.staleAfterSeconds + 5) * 1_000
        val result = classifyLocationQuality(base.copy(accuracyMeters = 999.0), null, laterMs)
        assertEquals(LocationQualityStatus.STALE, result.status)
    }
}
