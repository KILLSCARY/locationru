package ru.location.resilienttaxi.driver.core.maps

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

private const val EARTH_RADIUS_METERS = 6_371_008.8

private fun toRadians(degrees: Double): Double = degrees * PI / 180.0

/** Great-circle distance in metres between two points (haversine). */
fun haversineMeters(
    a: GeoPoint,
    b: GeoPoint,
): Double {
    val dLat = toRadians(b.latitude - a.latitude)
    val dLon = toRadians(b.longitude - a.longitude)
    val lat1 = toRadians(a.latitude)
    val lat2 = toRadians(b.latitude)

    val sinLat = sin(dLat / 2)
    val sinLon = sin(dLon / 2)
    val h = sinLat * sinLat + cos(lat1) * cos(lat2) * sinLon * sinLon

    return 2 * EARTH_RADIUS_METERS * asin(min(1.0, sqrt(h)))
}

/** Linear interpolation between two points (equirectangular approximation; city-scale only). */
fun lerpPoint(
    a: GeoPoint,
    b: GeoPoint,
    t: Double,
): GeoPoint {
    val clamped = t.coerceIn(0.0, 1.0)
    return GeoPoint(
        latitude = a.latitude + (b.latitude - a.latitude) * clamped,
        longitude = a.longitude + (b.longitude - a.longitude) * clamped,
    )
}

/** Shortest-path interpolation between two bearings (handles the 0/360 wrap). */
fun lerpBearing(
    a: Double?,
    b: Double?,
    t: Double,
): Double? {
    if (a == null) return b
    if (b == null) return a
    val clamped = t.coerceIn(0.0, 1.0)
    val delta = ((b - a + 540) % 360) - 180
    val result = a + delta * clamped
    return (result % 360 + 360) % 360
}

/** Compass bearing in degrees (0..360, 0 = north) from `a` to `b`. */
fun bearingBetween(
    a: GeoPoint,
    b: GeoPoint,
): Double {
    val lat1 = toRadians(a.latitude)
    val lat2 = toRadians(b.latitude)
    val dLon = toRadians(b.longitude - a.longitude)
    val y = sin(dLon) * cos(lat2)
    val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
    val bearing = atan2(y, x) * 180 / PI
    return (bearing + 360) % 360
}

data class SegmentProjection(
    val projected: GeoPoint,
    val t: Double,
)

/** Projects `point` onto the segment a→b; returns the projection and its t in [0, 1]. */
fun projectOntoSegment(
    point: GeoPoint,
    a: GeoPoint,
    b: GeoPoint,
): SegmentProjection {
    val latScale = cos(toRadians((a.latitude + b.latitude) / 2)).let { if (it == 0.0) 1e-9 else it }
    val ax = a.longitude * latScale
    val ay = a.latitude
    val bx = b.longitude * latScale
    val by = b.latitude
    val px = point.longitude * latScale
    val py = point.latitude

    val dx = bx - ax
    val dy = by - ay
    val lengthSquared = dx * dx + dy * dy

    val t =
        if (lengthSquared == 0.0) {
            0.0
        } else {
            (((px - ax) * dx + (py - ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
        }

    return SegmentProjection(
        projected = GeoPoint(latitude = ay + dy * t, longitude = (ax + dx * t) / latScale),
        t = t,
    )
}

/** Total length in metres along an ordered polyline. */
fun polylineLengthMeters(points: List<GeoPoint>): Double {
    var total = 0.0
    for (index in 1 until points.size) {
        total += haversineMeters(points[index - 1], points[index])
    }
    return total
}
