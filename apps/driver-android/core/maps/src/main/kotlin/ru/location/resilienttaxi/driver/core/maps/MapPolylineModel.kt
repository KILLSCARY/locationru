package ru.location.resilienttaxi.driver.core.maps

enum class MapPolylineKind {
    ROUTE,
    TRAVELED,
    REMAINING,
}

data class MapPolylineModel(
    val id: String,
    val kind: MapPolylineKind,
    val points: List<GeoPoint>,
)
