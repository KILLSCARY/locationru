package ru.location.resilienttaxi.driver.core.maps

data class MapControllerOptions(
    /** Re-centre only when the target moved at least this far since the last render (metres). */
    val minMoveMetersToRecenter: Double = 8.0,
    /** Re-centre only when bearing changed at least this much (degrees). */
    val minBearingChangeDegrees: Double = 12.0,
)

/**
 * Pure follow-mode camera state machine, orchestrating a [MapProvider]. It
 * never touches a native map view directly — it decides *whether and how* the
 * camera should move, and applies the resulting [CameraCommand] through the
 * injected provider. Kept SDK-agnostic and side-effect-light so it is
 * trivially unit-testable.
 */
class MapController(
    private val provider: MapProvider,
    private val options: MapControllerOptions = MapControllerOptions(),
) {
    var isFollowing: Boolean = false
        private set
    var lastCommand: CameraCommand? = null
        private set

    private var lastFollowedPoint: GeoPoint? = null
    private var lastFollowedBearing: Double? = null

    fun fitRouteBounds(bounds: MapBoundsModel) {
        val command = CameraCommand.FitBounds(bounds)
        lastCommand = command
        isFollowing = false
        provider.applyCamera(command)
    }

    fun focusPoint(
        point: GeoPoint,
        zoom: Float? = null,
    ) {
        val command = CameraCommand.FocusPoint(point, zoom)
        lastCommand = command
        isFollowing = false
        provider.applyCamera(command)
    }

    /** Enables follow mode and immediately centres on the target. */
    fun startFollowing(
        point: GeoPoint,
        bearingDegrees: Double?,
    ) {
        lastFollowedPoint = point
        lastFollowedBearing = bearingDegrees
        val command = CameraCommand.FollowTarget(point, bearingDegrees)
        lastCommand = command
        isFollowing = true
        provider.applyCamera(command)
    }

    /**
     * Called on every position update while following. Applies a new camera
     * command only when the target moved/turned enough to be worth a
     * re-centre — protects against constant sharp jumps from GPS jitter.
     */
    fun updatePosition(
        point: GeoPoint,
        bearingDegrees: Double?,
    ) {
        if (!isFollowing) return

        val moved = lastFollowedPoint?.let { haversineMeters(it, point) } ?: Double.POSITIVE_INFINITY
        val turned =
            when {
                lastFollowedBearing != null && bearingDegrees != null ->
                    kotlin.math.abs(angularDelta(lastFollowedBearing!!, bearingDegrees))
                bearingDegrees != null -> Double.POSITIVE_INFINITY
                else -> 0.0
            }

        if (moved < options.minMoveMetersToRecenter && turned < options.minBearingChangeDegrees) {
            return
        }

        lastFollowedPoint = point
        lastFollowedBearing = bearingDegrees
        val command = CameraCommand.FollowTarget(point, bearingDegrees)
        lastCommand = command
        provider.applyCamera(command)
    }

    /** Called when the user drags/zooms the map by hand. */
    fun onManualCameraMove() {
        isFollowing = false
    }

    /** "Return to follow mode" — re-centres on the last known target position. */
    fun resumeFollowing() {
        val point = lastFollowedPoint ?: return
        startFollowing(point, lastFollowedBearing)
    }

    private fun angularDelta(
        a: Double,
        b: Double,
    ): Double = ((b - a + 540) % 360) - 180
}
