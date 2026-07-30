package ru.location.resilienttaxi.driver.core.maps

sealed interface CameraCommand {
    data class FitBounds(
        val bounds: MapBoundsModel,
    ) : CameraCommand

    data class FocusPoint(
        val point: GeoPoint,
        val zoom: Float? = null,
    ) : CameraCommand

    data class FollowTarget(
        val point: GeoPoint,
        val bearingDegrees: Double?,
    ) : CameraCommand
}
