package ru.location.resilienttaxi.driver.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class CommissionCalculatorTest {
    @Test
    fun `splits the fare by basis points and floors the commission`() {
        val breakdown =
            CommissionCalculator.breakdown(
                totalKopecks = 12_345,
                commissionBasisPoints = 1_500,
            )

        // floor(12345 * 1500 / 10000) = floor(1851.75) = 1851
        assertEquals(1_851, breakdown.commissionKopecks)
        assertEquals(12_345 - 1_851, breakdown.driverPayoutKopecks)
    }

    @Test
    fun `applies the minimum commission`() {
        val breakdown =
            CommissionCalculator.breakdown(
                totalKopecks = 10_000,
                commissionBasisPoints = 100,
                minimumCommissionKopecks = 500,
            )

        // percentage = 100, minimum 500 wins
        assertEquals(500, breakdown.commissionKopecks)
        assertEquals(9_500, breakdown.driverPayoutKopecks)
    }

    @Test
    fun `never charges more than the total`() {
        val breakdown =
            CommissionCalculator.breakdown(
                totalKopecks = 300,
                commissionBasisPoints = 0,
                minimumCommissionKopecks = 1_000,
            )

        assertEquals(300, breakdown.commissionKopecks)
        assertEquals(0, breakdown.driverPayoutKopecks)
    }

    @Test
    fun `does not overflow on a large fare`() {
        val breakdown =
            CommissionCalculator.breakdown(
                totalKopecks = 2_000_000_000,
                commissionBasisPoints = 10_000,
            )

        assertEquals(2_000_000_000, breakdown.commissionKopecks)
        assertEquals(0, breakdown.driverPayoutKopecks)
    }

    @Test
    fun `rejects invalid arguments`() {
        assertFailsWith<IllegalArgumentException> {
            CommissionCalculator.breakdown(-1, 800)
        }
        assertFailsWith<IllegalArgumentException> {
            CommissionCalculator.breakdown(100, 10_001)
        }
    }
}
