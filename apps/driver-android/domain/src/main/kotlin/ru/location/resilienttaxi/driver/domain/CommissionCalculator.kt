package ru.location.resilienttaxi.driver.domain

/** Fare split between platform commission and driver payout, in kopecks. */
data class FareBreakdown(
    val totalKopecks: Int,
    val commissionBasisPoints: Int,
    val commissionKopecks: Int,
    val driverPayoutKopecks: Int,
)

/**
 * Estimates the driver payout, mirroring the server `FareCalculator` so the app
 * shows the same numbers the backend records: commission is
 * `floor(total * basisPoints / 10000)`, clamped to at least
 * [minimumCommissionKopecks] and never more than the total.
 *
 * This is an on-device estimate for display; the authoritative split is
 * computed and stored server-side when the trip is created.
 */
object CommissionCalculator {
    const val MAX_BASIS_POINTS = 10_000

    fun breakdown(
        totalKopecks: Int,
        commissionBasisPoints: Int,
        minimumCommissionKopecks: Int = 0,
    ): FareBreakdown {
        require(totalKopecks >= 0) { "totalKopecks must be non-negative" }
        require(commissionBasisPoints in 0..MAX_BASIS_POINTS) {
            "commissionBasisPoints must be between 0 and $MAX_BASIS_POINTS"
        }
        require(minimumCommissionKopecks >= 0) {
            "minimumCommissionKopecks must be non-negative"
        }

        // Widen to Long so a large fare times basis points cannot overflow Int.
        val percentage =
            (totalKopecks.toLong() * commissionBasisPoints / MAX_BASIS_POINTS).toInt()
        val commission = minOf(totalKopecks, maxOf(minimumCommissionKopecks, percentage))

        return FareBreakdown(
            totalKopecks = totalKopecks,
            commissionBasisPoints = commissionBasisPoints,
            commissionKopecks = commission,
            driverPayoutKopecks = totalKopecks - commission,
        )
    }
}
