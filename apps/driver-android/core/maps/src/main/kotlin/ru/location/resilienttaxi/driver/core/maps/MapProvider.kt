package ru.location.resilienttaxi.driver.core.maps

/**
 * The contract a concrete map SDK wrapper (a real Yandex MapKit view, or the
 * development fallback) must satisfy. `MapController` and every screen depend
 * on this interface only — never on a map SDK's own types — so swapping the
 * concrete implementation never touches domain or screen code.
 */
interface MapProvider {
    fun setMarkers(markers: List<MapMarkerModel>)

    fun setPolylines(polylines: List<MapPolylineModel>)

    fun applyCamera(command: CameraCommand)
}
