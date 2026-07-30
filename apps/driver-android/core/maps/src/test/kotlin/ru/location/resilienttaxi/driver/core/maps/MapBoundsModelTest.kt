package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MapBoundsModelTest {
    @Test
    fun `of covers every point exactly`() {
        val bounds =
            MapBoundsModel.of(
                listOf(GeoPoint(59.93, 30.35), GeoPoint(59.8, 30.26), GeoPoint(59.9, 30.4)),
            )
        assertEquals(MapBoundsModel(59.8, 30.26, 59.93, 30.4), bounds)
    }

    @Test
    fun `of throws on an empty list`() {
        assertFailsWith<IllegalArgumentException> { MapBoundsModel.of(emptyList()) }
    }

    @Test
    fun `union covers both input boxes`() {
        val a = MapBoundsModel(0.0, 0.0, 1.0, 1.0)
        val b = MapBoundsModel(2.0, 2.0, 3.0, 3.0)
        assertEquals(MapBoundsModel(0.0, 0.0, 3.0, 3.0), a.union(b))
    }

    @Test
    fun `padded expands symmetrically by the given ratio`() {
        val bounds = MapBoundsModel(10.0, 10.0, 20.0, 20.0)
        val padded = bounds.padded(0.1)
        assertEquals(9.0, padded.minLatitude)
        assertEquals(21.0, padded.maxLatitude)
        assertEquals(9.0, padded.minLongitude)
        assertEquals(21.0, padded.maxLongitude)
    }

    @Test
    fun `center is the midpoint`() {
        val bounds = MapBoundsModel(0.0, 0.0, 10.0, 20.0)
        assertEquals(GeoPoint(5.0, 10.0), bounds.center)
    }

    @Test
    fun `contains respects box edges inclusively`() {
        val bounds = MapBoundsModel(0.0, 0.0, 10.0, 10.0)
        assertTrue(bounds.contains(GeoPoint(0.0, 0.0)))
        assertTrue(bounds.contains(GeoPoint(10.0, 10.0)))
        assertFalse(bounds.contains(GeoPoint(11.0, 5.0)))
    }
}
