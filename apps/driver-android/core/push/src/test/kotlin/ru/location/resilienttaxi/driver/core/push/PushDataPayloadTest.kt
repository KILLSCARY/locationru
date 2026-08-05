package ru.location.resilienttaxi.driver.core.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushDataPayloadTest {
    @Test
    fun `parses a full payload`() {
        val payload =
            PushDataPayload.parse(
                mapOf(
                    "notificationId" to "notif-1",
                    "type" to "DRIVER_NEW_TRIP_AVAILABLE",
                    "tripId" to "trip-1",
                    "sequence" to "12345",
                    "deepLink" to "resilienttaxi://driver/orders/trip-1",
                    "occurredAt" to "2026-01-01T00:00:00Z",
                ),
            )

        assertEquals("notif-1", payload?.notificationId)
        assertEquals("trip-1", payload?.tripId)
        assertNull(payload?.bidId)
        assertNull(payload?.paymentId)
        assertEquals(12345L, payload?.sequence)
    }

    @Test
    fun `returns null when notificationId is missing`() {
        assertNull(PushDataPayload.parse(mapOf("type" to "DRIVER_NEW_TRIP_AVAILABLE")))
    }

    @Test
    fun `returns null when type is missing`() {
        assertNull(PushDataPayload.parse(mapOf("notificationId" to "notif-1")))
    }

    @Test
    fun `tolerates a non-numeric sequence rather than crashing`() {
        val payload =
            PushDataPayload.parse(
                mapOf(
                    "notificationId" to "notif-1",
                    "type" to "SYSTEM_SERVICE_NOTICE",
                    "sequence" to "not-a-number",
                ),
            )

        assertNull(payload?.sequence)
    }

    @Test
    fun `deepLinkPath extracts the path after the driver scheme host`() {
        val payload =
            PushDataPayload.parse(
                mapOf(
                    "notificationId" to "notif-1",
                    "type" to "DRIVER_NEW_TRIP_AVAILABLE",
                    "deepLink" to "resilienttaxi://driver/orders/trip-1",
                ),
            )

        assertEquals("orders/trip-1", payload?.deepLinkPath())
    }

    @Test
    fun `deepLinkPath is null for a link that doesn't match the driver scheme`() {
        val payload =
            PushDataPayload.parse(
                mapOf(
                    "notificationId" to "notif-1",
                    "type" to "PASSENGER_TRIP_STARTED",
                    "deepLink" to "resilienttaxi://passenger/trip/trip-1",
                ),
            )

        assertNull(payload?.deepLinkPath())
    }
}
