package ru.location.resilienttaxi.driver.domain

/**
 * Six-digit one-time code helpers, matching the OTP format issued by the
 * server. [sanitize] supports progressive text input; [isValid] gates
 * submission.
 */
object OtpCode {
    const val LENGTH = 6

    private val SIX_DIGITS = Regex("^\\d{$LENGTH}$")

    fun isValid(code: String): Boolean = SIX_DIGITS.matches(code)

    /** Keeps only digits and truncates to [LENGTH], for text-field input. */
    fun sanitize(raw: String): String = raw.filter(Char::isDigit).take(LENGTH)
}
