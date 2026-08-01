package ru.location.resilienttaxi.driver.core.push

import org.junit.Assert.assertEquals
import org.junit.Test

class PushNotificationChannelTest {
    @Test
    fun `byId resolves every registered channel id back to itself`() {
        PushNotificationChannel.entries.forEach { channel ->
            assertEquals(channel, PushNotificationChannel.byId(channel.id))
        }
    }

    @Test
    fun `byId falls back to ACCOUNT for an unknown or missing id`() {
        assertEquals(PushNotificationChannel.ACCOUNT, PushNotificationChannel.byId("not_a_real_channel"))
        assertEquals(PushNotificationChannel.ACCOUNT, PushNotificationChannel.byId(null))
    }

    @Test
    fun `channel ids match the backend's ANDROID_CHANNEL_BY_CATEGORY mapping`() {
        // Mirrors firebase-push.provider.ts's ANDROID_CHANNEL_BY_CATEGORY —
        // a drift here would mean a background push lands in the wrong
        // Android channel (wrong importance/sound) even though the app's
        // own foreground handling stays correct.
        assertEquals("trip_offers", PushNotificationChannel.TRIP_OFFERS.id)
        assertEquals("active_trip", PushNotificationChannel.ACTIVE_TRIP.id)
        assertEquals("payments", PushNotificationChannel.PAYMENTS.id)
        assertEquals("driver_operations", PushNotificationChannel.DRIVER_OPERATIONS.id)
        assertEquals("account", PushNotificationChannel.ACCOUNT.id)
        assertEquals("security", PushNotificationChannel.SECURITY.id)
    }
}
