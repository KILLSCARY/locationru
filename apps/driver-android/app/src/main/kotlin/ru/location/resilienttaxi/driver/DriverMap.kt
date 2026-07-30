package ru.location.resilienttaxi.driver

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.yandex.mapkit.MapKitFactory
import com.yandex.mapkit.mapview.MapView
import ru.location.resilienttaxi.driver.core.maps.MapController
import ru.location.resilienttaxi.driver.core.maps.MapMarkerModel
import ru.location.resilienttaxi.driver.core.maps.MapPolylineModel
import ru.location.resilienttaxi.driver.core.maps.yandex.YandexMapProvider

/**
 * Renders the driver's map — Yandex MapKit when a key is configured,
 * otherwise [DevelopmentMapView]. Screens never touch MapKit directly: they
 * pass [markers]/[polylines] declaratively and drive the camera through the
 * [MapController] handed back via [onControllerReady].
 */
@Composable
fun DriverMap(
    markers: List<MapMarkerModel>,
    polylines: List<MapPolylineModel>,
    modifier: Modifier = Modifier,
    onControllerReady: (MapController) -> Unit = {},
) {
    if (BuildConfig.MAPKIT_API_KEY.isBlank()) {
        DevelopmentMapView(markers, polylines, modifier)
        return
    }

    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val mapView = remember { MapView(context) }
    val provider = remember(mapView) { YandexMapProvider(mapView.mapWindow.map) }
    val controller = remember(provider) { MapController(provider) }

    LaunchedEffect(controller) { onControllerReady(controller) }
    LaunchedEffect(provider, markers) { provider.setMarkers(markers) }
    LaunchedEffect(provider, polylines) { provider.setPolylines(polylines) }

    DisposableEffect(lifecycleOwner) {
        val observer =
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> {
                        MapKitFactory.getInstance().onStart()
                        mapView.onStart()
                    }
                    Lifecycle.Event.ON_STOP -> {
                        mapView.onStop()
                        MapKitFactory.getInstance().onStop()
                    }
                    else -> Unit
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    AndroidView(factory = { mapView }, modifier = modifier)
}
