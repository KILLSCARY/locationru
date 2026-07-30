package ru.location.resilienttaxi.driver.core.maps

/**
 * Provider-agnostic coordinate. Domain and map-orchestration code depends on
 * this type only — never on a concrete map SDK's own point class — so a
 * screen never needs to import MapKit (or any other SDK) to reason about a
 * route, a marker or a camera command.
 */
data class GeoPoint(
    val latitude: Double,
    val longitude: Double,
)
