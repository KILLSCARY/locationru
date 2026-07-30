package ru.location.resilienttaxi.driver.core.maps.yandex

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import com.yandex.mapkit.Animation
import com.yandex.mapkit.geometry.BoundingBox
import com.yandex.mapkit.geometry.Circle
import com.yandex.mapkit.geometry.Geometry
import com.yandex.mapkit.geometry.Point
import com.yandex.mapkit.geometry.Polyline
import com.yandex.mapkit.map.CameraPosition
import com.yandex.mapkit.map.IconStyle
import com.yandex.mapkit.map.RotationType
import com.yandex.runtime.image.ImageProvider
import ru.location.resilienttaxi.driver.core.maps.CameraCommand
import ru.location.resilienttaxi.driver.core.maps.GeoPoint
import ru.location.resilienttaxi.driver.core.maps.MapBoundsModel
import ru.location.resilienttaxi.driver.core.maps.MapMarkerKind
import ru.location.resilienttaxi.driver.core.maps.MapMarkerModel
import ru.location.resilienttaxi.driver.core.maps.MapPolylineKind
import ru.location.resilienttaxi.driver.core.maps.MapPolylineModel
import ru.location.resilienttaxi.driver.core.maps.MapProvider
import com.yandex.mapkit.map.Map as YandexMap

private const val CAMERA_ANIMATION_SECONDS = 0.6f
private const val DEFAULT_ZOOM = 15f
private const val FOLLOW_ZOOM = 17f
private const val MARKER_RADIUS_METERS = 12f

private val MARKER_COLORS =
    mapOf(
        MapMarkerKind.PICKUP to Color.parseColor("#34C759"),
        MapMarkerKind.DESTINATION to Color.parseColor("#FF3B30"),
        MapMarkerKind.ORDER_CANDIDATE to Color.parseColor("#FF9500"),
        MapMarkerKind.PASSENGER to Color.parseColor("#FFFFFF"),
    )

/**
 * Real map adapter backed by Yandex MapKit. Implements the SDK-agnostic
 * [MapProvider] contract from `core:maps` — nothing outside this module
 * imports a MapKit type, so [ru.location.resilienttaxi.driver.core.maps.MapController]
 * and every screen stay portable to a different SDK.
 *
 * Lives in its own kapt-free module: kapt's javac-based stub generator
 * cannot read some of this AAR's class files (a newer bytecode version than
 * kapt's stub compiler accepts), and that only becomes a problem for a module
 * that *stores* a MapKit-typed property or exposes one in a function
 * signature — as this class does. `:app` (which needs kapt for Hilt) never
 * declares such a signature; it only uses MapKit types inside expression
 * bodies, which kapt does not need to stub.
 */
class YandexMapProvider(
    private val map: YandexMap,
) : MapProvider {
    override fun setMarkers(markers: List<MapMarkerModel>) {
        map.mapObjects.clear()
        for (marker in markers) {
            if (marker.kind == MapMarkerKind.DRIVER) {
                addDriverPlacemark(marker)
            } else {
                addCircleMarker(marker)
            }
        }
    }

    override fun setPolylines(polylines: List<MapPolylineModel>) {
        for (polyline in polylines) {
            val strokeColor =
                when (polyline.kind) {
                    MapPolylineKind.TRAVELED -> Color.parseColor("#5A5F6A")
                    MapPolylineKind.ROUTE, MapPolylineKind.REMAINING -> Color.parseColor("#12B0FF")
                }
            map.mapObjects.addPolyline(Polyline(polyline.points.map { it.toYandexPoint() })).apply {
                setStrokeColor(strokeColor)
                strokeWidth = 4f
            }
        }
    }

    override fun applyCamera(command: CameraCommand) {
        val animation = Animation(Animation.Type.SMOOTH, CAMERA_ANIMATION_SECONDS)
        when (command) {
            is CameraCommand.FitBounds -> {
                val target = map.cameraPosition(Geometry.fromBoundingBox(command.bounds.toBoundingBox()))
                map.move(target, animation, null)
            }
            is CameraCommand.FocusPoint -> {
                map.move(
                    CameraPosition(command.point.toYandexPoint(), command.zoom ?: DEFAULT_ZOOM, 0f, 0f),
                    animation,
                    null,
                )
            }
            is CameraCommand.FollowTarget -> {
                map.move(
                    CameraPosition(
                        command.point.toYandexPoint(),
                        FOLLOW_ZOOM,
                        command.bearingDegrees?.toFloat() ?: 0f,
                        0f,
                    ),
                    animation,
                    null,
                )
            }
        }
    }

    private fun addCircleMarker(marker: MapMarkerModel) {
        val color = MARKER_COLORS[marker.kind] ?: Color.WHITE
        map.mapObjects.addCircle(Circle(marker.location.toYandexPoint(), MARKER_RADIUS_METERS)).apply {
            fillColor = color
            strokeColor = Color.BLACK
            strokeWidth = 2f
        }
    }

    private fun addDriverPlacemark(marker: MapMarkerModel) {
        val placemark = map.mapObjects.addPlacemark(marker.location.toYandexPoint())
        placemark.setIcon(
            ImageProvider.fromBitmap(driverArrowBitmap()),
            IconStyle().setAnchor(PointF(0.5f, 0.5f)).setRotationType(RotationType.ROTATE),
        )
        placemark.direction = marker.bearingDegrees?.toFloat() ?: 0f
    }

    private fun driverArrowBitmap(): Bitmap {
        val size = 48
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#12B0FF")
                style = Paint.Style.FILL
            }
        // A simple north-pointing triangle; setDirection() rotates it to bearing.
        val path =
            Path().apply {
                moveTo(size / 2f, 4f)
                lineTo(size - 8f, size - 8f)
                lineTo(size / 2f, size - 20f)
                lineTo(8f, size - 8f)
                close()
            }
        canvas.drawPath(path, paint)
        return bitmap
    }
}

private fun GeoPoint.toYandexPoint(): Point = Point(latitude, longitude)

private fun MapBoundsModel.toBoundingBox(): BoundingBox = BoundingBox(Point(minLatitude, minLongitude), Point(maxLatitude, maxLongitude))
