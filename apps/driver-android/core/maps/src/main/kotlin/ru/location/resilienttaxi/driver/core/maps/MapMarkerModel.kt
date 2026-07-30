package ru.location.resilienttaxi.driver.core.maps

enum class MapMarkerKind {
    PICKUP,
    DESTINATION,
    DRIVER,
    PASSENGER,
    ORDER_CANDIDATE,
}

data class MapMarkerModel(
    val id: String,
    val kind: MapMarkerKind,
    val location: GeoPoint,
    /** Heading in degrees, 0..360. Only meaningful for the driver's own marker. */
    val bearingDegrees: Double? = null,
    val label: String? = null,
)
