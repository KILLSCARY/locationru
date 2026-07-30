package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RouteProgressTest {
    private val straightRoute =
        listOf(
            GeoPoint(59.9, 30.3),
            GeoPoint(59.91, 30.3),
            GeoPoint(59.92, 30.3),
            GeoPoint(59.93, 30.3),
        )

    @Test
    fun `splits traveled and remaining at the projected position`() {
        val progress = computeRouteProgress(straightRoute, GeoPoint(59.915, 30.3))

        assertEquals(1, progress.segmentIndex)
        assertTrue(progress.traveled.size >= 2)
        assertTrue(progress.remaining.size >= 2)
        assertEquals(progress.traveled.last().latitude, progress.remaining.first().latitude)
    }

    @Test
    fun `puts everything in remaining at the route start`() {
        val progress = computeRouteProgress(straightRoute, straightRoute.first())
        assertEquals(1, progress.traveled.size)
        assertEquals(straightRoute.size, progress.remaining.size)
    }

    @Test
    fun `puts everything in traveled at the route end`() {
        val progress = computeRouteProgress(straightRoute, straightRoute.last())
        assertEquals(1, progress.remaining.size)
    }

    @Test
    fun `reports off-route distance for a point away from the line`() {
        val progress = computeRouteProgress(straightRoute, GeoPoint(59.915, 30.31))
        assertTrue(progress.distanceFromRouteMeters > 400)
    }

    @Test
    fun `degrades gracefully for a single-point geometry`() {
        val progress = computeRouteProgress(listOf(GeoPoint(59.9, 30.3)), GeoPoint(59.91, 30.3))
        assertEquals(0, progress.traveled.size)
        assertEquals(1, progress.remaining.size)
        assertTrue(progress.distanceFromRouteMeters > 0)
    }
}
