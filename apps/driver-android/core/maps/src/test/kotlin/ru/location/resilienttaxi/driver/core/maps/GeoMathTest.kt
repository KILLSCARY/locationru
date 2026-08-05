package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GeoMathTest {
    @Test
    fun `haversineMeters is zero for identical points`() {
        val p = GeoPoint(59.93, 30.35)
        assertEquals(0.0, haversineMeters(p, p))
    }

    @Test
    fun `haversineMeters matches a known distance (1 deg latitude approx 111_2 km)`() {
        val distance = haversineMeters(GeoPoint(0.0, 0.0), GeoPoint(1.0, 0.0))
        assertTrue(distance in 110_000.0..112_000.0)
    }

    @Test
    fun `lerpPoint at t=0 and t=1 returns the endpoints`() {
        val a = GeoPoint(0.0, 0.0)
        val b = GeoPoint(10.0, 20.0)
        assertEquals(a, lerpPoint(a, b, 0.0))
        assertEquals(b, lerpPoint(a, b, 1.0))
    }

    @Test
    fun `bearingBetween points due north is approximately 0`() {
        val bearing = bearingBetween(GeoPoint(59.9, 30.3), GeoPoint(59.91, 30.3))
        assertTrue(bearing < 1 || bearing > 359)
    }

    @Test
    fun `bearingBetween points due east is approximately 90`() {
        val bearing = bearingBetween(GeoPoint(59.9, 30.3), GeoPoint(59.9, 30.31))
        assertTrue(kotlin.math.abs(bearing - 90) < 1)
    }

    @Test
    fun `projectOntoSegment clamps t to the segment endpoints`() {
        val a = GeoPoint(0.0, 0.0)
        val b = GeoPoint(0.0, 1.0)
        val beforeStart = projectOntoSegment(GeoPoint(0.0, -1.0), a, b)
        assertEquals(0.0, beforeStart.t)
        val afterEnd = projectOntoSegment(GeoPoint(0.0, 2.0), a, b)
        assertEquals(1.0, afterEnd.t)
    }

    @Test
    fun `polylineLengthMeters sums segment distances`() {
        val length =
            polylineLengthMeters(
                listOf(GeoPoint(59.9, 30.3), GeoPoint(59.91, 30.3), GeoPoint(59.92, 30.3)),
            )
        assertTrue(length in 2_100.0..2_300.0)
    }
}
