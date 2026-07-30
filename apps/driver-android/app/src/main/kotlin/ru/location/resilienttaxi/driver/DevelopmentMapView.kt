package ru.location.resilienttaxi.driver

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp
import ru.location.resilienttaxi.driver.core.maps.GeoPoint
import ru.location.resilienttaxi.driver.core.maps.MapBoundsModel
import ru.location.resilienttaxi.driver.core.maps.MapMarkerKind
import ru.location.resilienttaxi.driver.core.maps.MapMarkerModel
import ru.location.resilienttaxi.driver.core.maps.MapPolylineKind
import ru.location.resilienttaxi.driver.core.maps.MapPolylineModel

private val InkBackground = Color(0xFF14151A)
private val GridLine = Color(0xFF26282E)
private val TraveledColor = Color(0xFF5A5F6A)
private val RouteColor = Color(0xFF12B0FF)

private val MARKER_COLORS =
    mapOf(
        MapMarkerKind.PICKUP to Color(0xFF34C759),
        MapMarkerKind.DESTINATION to Color(0xFFFF3B30),
        MapMarkerKind.DRIVER to Color(0xFF12B0FF),
        MapMarkerKind.PASSENGER to Color.White,
        MapMarkerKind.ORDER_CANDIDATE to Color(0xFFFF9500),
    )

/**
 * Fully offline map view: no external SDK. Auto-fits its viewport to whatever
 * markers/polylines it is given and draws a coordinate grid, markers, a
 * polyline and coordinate labels on a plain [Canvas]. Development-only —
 * forbidden in production (see the prod-flavor build guard in
 * app/build.gradle.kts).
 */
@Composable
fun DevelopmentMapView(
    markers: List<MapMarkerModel>,
    polylines: List<MapPolylineModel>,
    modifier: Modifier = Modifier,
) {
    val textMeasurer = rememberTextMeasurer()
    val viewport = viewportFor(markers, polylines)

    Canvas(modifier = modifier.fillMaxSize()) {
        drawRect(color = InkBackground, size = size)
        drawGrid()

        for (polyline in polylines) {
            drawPolylineOn(polyline, viewport)
        }
        for (marker in markers) {
            drawMarkerOn(marker, viewport, textMeasurer)
        }
    }
}

private fun viewportFor(
    markers: List<MapMarkerModel>,
    polylines: List<MapPolylineModel>,
): MapBoundsModel {
    val points = markers.map { it.location } + polylines.flatMap { it.points }
    if (points.isEmpty()) {
        return MapBoundsModel(59.85, 30.25, 59.98, 30.45) // St. Petersburg fallback.
    }
    return MapBoundsModel.of(points).padded(0.25)
}

private fun DrawScope.projectOn(
    point: GeoPoint,
    viewport: MapBoundsModel,
): Offset {
    val lonSpan = (viewport.maxLongitude - viewport.minLongitude).let { if (it == 0.0) 1e-9 else it }
    val latSpan = (viewport.maxLatitude - viewport.minLatitude).let { if (it == 0.0) 1e-9 else it }
    return Offset(
        x = (((point.longitude - viewport.minLongitude) / lonSpan) * size.width).toFloat(),
        y = (((viewport.maxLatitude - point.latitude) / latSpan) * size.height).toFloat(),
    )
}

private fun DrawScope.drawGrid() {
    val steps = 9
    for (i in 1..steps) {
        val fraction = i / (steps + 1f)
        drawLine(GridLine, Offset(size.width * fraction, 0f), Offset(size.width * fraction, size.height), 1f)
        drawLine(GridLine, Offset(0f, size.height * fraction), Offset(size.width, size.height * fraction), 1f)
    }
}

private fun DrawScope.drawPolylineOn(
    polyline: MapPolylineModel,
    viewport: MapBoundsModel,
) {
    val color = if (polyline.kind == MapPolylineKind.TRAVELED) TraveledColor else RouteColor
    val points = polyline.points
    for (index in 0 until points.size - 1) {
        drawLine(
            color = color,
            start = projectOn(points[index], viewport),
            end = projectOn(points[index + 1], viewport),
            strokeWidth = 4f,
        )
    }
}

private fun DrawScope.drawMarkerOn(
    marker: MapMarkerModel,
    viewport: MapBoundsModel,
    textMeasurer: androidx.compose.ui.text.TextMeasurer,
) {
    val center = projectOn(marker.location, viewport)
    val color = MARKER_COLORS[marker.kind] ?: Color.White
    drawCircle(color = color, radius = 10f, center = center)
    drawCircle(color = Color.Black, radius = 10f, center = center, style = Stroke(width = 2f))

    val label =
        marker.label ?: "%.4f, %.4f".format(marker.location.latitude, marker.location.longitude)
    val layout = textMeasurer.measure(text = label, style = TextStyle(color = Color.White, fontSize = 9.sp))
    drawText(
        textLayoutResult = layout,
        topLeft = Offset(center.x - layout.size.width / 2f, center.y + 12f),
    )
}
