package ru.location.resilienttaxi.driver.core.maps

import kotlin.test.Test
import kotlin.test.assertEquals

class RoomSequenceTrackerTest {
    @Test
    fun `applies the next-in-order sequence and advances`() {
        val tracker = RoomSequenceTracker(0)
        assertEquals(SequenceOutcome.Apply, tracker.observe(1))
        assertEquals(1, tracker.current)
    }

    @Test
    fun `flags an out-of-order or duplicate event without advancing`() {
        val tracker = RoomSequenceTracker(5)
        assertEquals(SequenceOutcome.DuplicateOrOld, tracker.observe(5))
        assertEquals(SequenceOutcome.DuplicateOrOld, tracker.observe(3))
        assertEquals(5, tracker.current)
    }

    @Test
    fun `detects a gap when a sequence skips ahead`() {
        val tracker = RoomSequenceTracker(5)
        val outcome = tracker.observe(8)
        assertEquals(SequenceOutcome.GapDetected(5, 8), outcome)
        assertEquals(5, tracker.current)
    }

    @Test
    fun `fastForwardTo applies the replay result and unblocks later events`() {
        val tracker = RoomSequenceTracker(5)
        tracker.observe(8)
        tracker.fastForwardTo(8)
        assertEquals(8, tracker.current)
        assertEquals(SequenceOutcome.Apply, tracker.observe(9))
    }

    @Test
    fun `fastForwardTo never moves the sequence backward`() {
        val tracker = RoomSequenceTracker(10)
        tracker.fastForwardTo(3)
        assertEquals(10, tracker.current)
    }
}
