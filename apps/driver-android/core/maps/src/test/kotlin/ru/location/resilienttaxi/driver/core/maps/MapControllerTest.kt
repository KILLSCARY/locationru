package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private class FakeMapProvider : MapProvider {
    val appliedCommands = mutableListOf<CameraCommand>()

    override fun setMarkers(markers: List<MapMarkerModel>) = Unit

    override fun setPolylines(polylines: List<MapPolylineModel>) = Unit

    override fun applyCamera(command: CameraCommand) {
        appliedCommands.add(command)
    }
}

class MapControllerTest {
    @Test
    fun `fitRouteBounds issues a FitBounds command and turns off following`() {
        val provider = FakeMapProvider()
        val controller = MapController(provider)
        val bounds = MapBoundsModel(0.0, 0.0, 1.0, 1.0)

        controller.fitRouteBounds(bounds)

        assertEquals(CameraCommand.FitBounds(bounds), provider.appliedCommands.last())
        assertFalse(controller.isFollowing)
    }

    @Test
    fun `startFollowing enables follow mode`() {
        val controller = MapController(FakeMapProvider())
        controller.startFollowing(GeoPoint(1.0, 1.0), 90.0)
        assertTrue(controller.isFollowing)
    }

    @Test
    fun `a manual camera move disables follow mode`() {
        val controller = MapController(FakeMapProvider())
        controller.startFollowing(GeoPoint(1.0, 1.0), 90.0)
        controller.onManualCameraMove()
        assertFalse(controller.isFollowing)
    }

    @Test
    fun `updatePosition is a no-op while not following`() {
        val provider = FakeMapProvider()
        val controller = MapController(provider)
        controller.updatePosition(GeoPoint(1.0, 1.0), 0.0)
        assertTrue(provider.appliedCommands.isEmpty())
    }

    @Test
    fun `updatePosition ignores tiny jitter`() {
        val provider = FakeMapProvider()
        val controller = MapController(provider, MapControllerOptions(minMoveMetersToRecenter = 50.0, minBearingChangeDegrees = 20.0))
        controller.startFollowing(GeoPoint(59.93, 30.35), 90.0)
        val callsBefore = provider.appliedCommands.size

        controller.updatePosition(GeoPoint(59.930001, 30.35), 91.0)

        assertEquals(callsBefore, provider.appliedCommands.size)
    }

    @Test
    fun `updatePosition recentres once movement exceeds the threshold`() {
        val provider = FakeMapProvider()
        val controller = MapController(provider, MapControllerOptions(minMoveMetersToRecenter = 10.0, minBearingChangeDegrees = 20.0))
        controller.startFollowing(GeoPoint(59.93, 30.35), 90.0)
        val callsBefore = provider.appliedCommands.size

        // ~1.1km south — well past the 10m threshold.
        controller.updatePosition(GeoPoint(59.92, 30.35), 90.0)

        assertTrue(provider.appliedCommands.size > callsBefore)
    }

    @Test
    fun `resumeFollowing re-enables follow at the last known position`() {
        val provider = FakeMapProvider()
        val controller = MapController(provider)
        controller.startFollowing(GeoPoint(59.93, 30.35), 90.0)
        controller.onManualCameraMove()
        assertFalse(controller.isFollowing)

        controller.resumeFollowing()

        assertTrue(controller.isFollowing)
        assertEquals(
            CameraCommand.FollowTarget(GeoPoint(59.93, 30.35), 90.0),
            provider.appliedCommands.last(),
        )
    }

    @Test
    fun `resumeFollowing is a no-op when the target has never been seen`() {
        val provider = FakeMapProvider()
        val controller = MapController(provider)
        controller.resumeFollowing()
        assertTrue(provider.appliedCommands.isEmpty())
    }
}
