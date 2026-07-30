package ru.location.resilienttaxi.driver.core.maps

data class MapBoundsModel(
    val minLatitude: Double,
    val minLongitude: Double,
    val maxLatitude: Double,
    val maxLongitude: Double,
) {
    companion object {
        /** Axis-aligned bounding box covering every point. Throws on an empty list. */
        fun of(points: List<GeoPoint>): MapBoundsModel {
            require(points.isNotEmpty()) { "MapBoundsModel.of requires at least one point" }
            return MapBoundsModel(
                minLatitude = points.minOf { it.latitude },
                minLongitude = points.minOf { it.longitude },
                maxLatitude = points.maxOf { it.latitude },
                maxLongitude = points.maxOf { it.longitude },
            )
        }
    }

    /** Combines this box with `other` into the smallest box covering both. */
    fun union(other: MapBoundsModel): MapBoundsModel =
        MapBoundsModel(
            minLatitude = minOf(minLatitude, other.minLatitude),
            minLongitude = minOf(minLongitude, other.minLongitude),
            maxLatitude = maxOf(maxLatitude, other.maxLatitude),
            maxLongitude = maxOf(maxLongitude, other.maxLongitude),
        )

    /** Expands this box by `ratio` of its own size on every side (e.g. 0.15 = 15% padding). */
    fun padded(ratio: Double): MapBoundsModel {
        val latSpan = (maxLatitude - minLatitude).let { if (it == 0.0) 0.001 else it }
        val lonSpan = (maxLongitude - minLongitude).let { if (it == 0.0) 0.001 else it }
        return MapBoundsModel(
            minLatitude = minLatitude - latSpan * ratio,
            minLongitude = minLongitude - lonSpan * ratio,
            maxLatitude = maxLatitude + latSpan * ratio,
            maxLongitude = maxLongitude + lonSpan * ratio,
        )
    }

    val center: GeoPoint
        get() = GeoPoint((minLatitude + maxLatitude) / 2, (minLongitude + maxLongitude) / 2)

    fun contains(point: GeoPoint): Boolean = point.latitude in minLatitude..maxLatitude && point.longitude in minLongitude..maxLongitude
}
