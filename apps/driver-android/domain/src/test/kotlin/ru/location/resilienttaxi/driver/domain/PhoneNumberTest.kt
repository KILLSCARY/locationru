package ru.location.resilienttaxi.driver.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PhoneNumberTest {
    @Test
    fun `keeps an international number and strips formatting`() {
        assertEquals("+79991234567", PhoneNumber.normalizeOrNull("+7 (999) 123-45-67"))
    }

    @Test
    fun `coerces a leading eight to the plus seven country code`() {
        assertEquals("+79991234567", PhoneNumber.normalizeOrNull("8 999 123 45 67"))
    }

    @Test
    fun `prefixes a bare ten-digit number with plus seven`() {
        assertEquals("+79991234567", PhoneNumber.normalizeOrNull("9991234567"))
    }

    @Test
    fun `keeps a non-russian international number`() {
        assertEquals("+123456789012", PhoneNumber.normalizeOrNull("+1 234 567 89012"))
    }

    @Test
    fun `rejects a too-short number`() {
        assertNull(PhoneNumber.normalizeOrNull("12345"))
        assertFalse(PhoneNumber.isValid("12345"))
    }

    @Test
    fun `rejects an empty input`() {
        assertNull(PhoneNumber.normalizeOrNull("   "))
    }

    @Test
    fun `reports validity`() {
        assertTrue(PhoneNumber.isValid("8 (999) 123-45-67"))
    }
}
