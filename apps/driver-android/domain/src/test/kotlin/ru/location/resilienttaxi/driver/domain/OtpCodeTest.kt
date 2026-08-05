package ru.location.resilienttaxi.driver.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OtpCodeTest {
    @Test
    fun `accepts exactly six digits`() {
        assertTrue(OtpCode.isValid("123456"))
    }

    @Test
    fun `rejects wrong length or non-digits`() {
        assertFalse(OtpCode.isValid("12345"))
        assertFalse(OtpCode.isValid("1234567"))
        assertFalse(OtpCode.isValid("12a456"))
        assertFalse(OtpCode.isValid(""))
    }

    @Test
    fun `sanitize keeps only digits and truncates to six`() {
        assertEquals("123456", OtpCode.sanitize("12-34-56-78"))
        assertEquals("12000", OtpCode.sanitize("12o000"))
    }
}
