package ru.location.resilienttaxi.driver.core.maps

data class RouteProgress(
    /** Route geometry from its start up to the car's projected position. */
    val traveled: List<GeoPoint>,
    /** Route geometry from the car's projected position to the end. */
    val remaining: List<GeoPoint>,
    /** Index of the geometry segment the car is currently on. */
    val segmentIndex: Int,
    /** Perpendicular distance from the car to the route, in metres. */
    val distanceFromRouteMeters: Double,
)

/**
 * Splits `geometry` into a traveled and a remaining polyline based on where
 * `currentPosition` projects onto it.
 */
fun computeRouteProgress(
    geometry: List<GeoPoint>,
    currentPosition: GeoPoint,
): RouteProgress {
    if (geometry.size < 2) {
        return RouteProgress(
            traveled = emptyList(),
            remaining = geometry,
            segmentIndex = 0,
            distanceFromRouteMeters = geometry.firstOrNull()?.let { haversineMeters(it, currentPosition) } ?: 0.0,
        )
    }

    var bestSegmentIndex = 0
    var bestT = 0.0
    var bestDistance = Double.POSITIVE_INFINITY
    var bestProjected = geometry[0]

    for (index in 0 until geometry.size - 1) {
        val a = geometry[index]
        val b = geometry[index + 1]
        val (projected, t) = projectOntoSegment(currentPosition, a, b)
        val distance = haversineMeters(currentPosition, projected)
        if (distance < bestDistance) {
            bestDistance = distance
            bestSegmentIndex = index
            bestT = t
            bestProjected = projected
        }
    }

    val traveled = geometry.subList(0, bestSegmentIndex + 1) + if (bestT > 0) listOf(bestProjected) else emptyList()
    val remaining = (if (bestT < 1) listOf(bestProjected) else emptyList()) + geometry.subList(bestSegmentIndex + 1, geometry.size)

    return RouteProgress(
        traveled = traveled,
        remaining = remaining,
        segmentIndex = bestSegmentIndex,
        distanceFromRouteMeters = bestDistance,
    )
}
