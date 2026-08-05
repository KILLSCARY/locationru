package ru.location.resilienttaxi.driver.domain

/**
 * Normalizes phone numbers to E.164, mirroring the server `PhoneNormalizer` so
 * the client and the API agree on what a valid number is. Russian numbers
 * entered without an international prefix are coerced to `+7`.
 */
object PhoneNumber {
    private val E164 = Regex("^\\+[1-9]\\d{7,14}$")

    /**
     * Returns the E.164 form (e.g. `+79991234567`), or `null` when the input is
     * not a valid phone number.
     */
    fun normalizeOrNull(input: String): String? {
        val trimmed = input.trim()
        val hasInternationalPrefix = trimmed.startsWith("+")
        var digits = trimmed.filter(Char::isDigit)

        if (!hasInternationalPrefix) {
            if (digits.length == 11 && digits.startsWith("8")) {
                digits = "7" + digits.substring(1)
            } else if (digits.length == 10) {
                digits = "7$digits"
            }
        }

        val normalized = "+$digits"
        return if (E164.matches(normalized)) normalized else null
    }

    fun isValid(input: String): Boolean = normalizeOrNull(input) != null
}
