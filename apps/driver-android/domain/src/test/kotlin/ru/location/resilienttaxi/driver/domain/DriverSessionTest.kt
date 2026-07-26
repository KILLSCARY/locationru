package ru.location.resilienttaxi.driver.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class DriverSessionTest {
    @Test
    fun `keeps access and refresh tokens as a single session`() {
        val session = DriverSession(accessToken = "access", refreshToken = "refresh")

        assertEquals("access", session.accessToken)
        assertEquals("refresh", session.refreshToken)
    }
}
