package ru.location.resilienttaxi.driver.core.maps

sealed interface SequenceOutcome {
    data object Apply : SequenceOutcome

    data object DuplicateOrOld : SequenceOutcome

    data class GapDetected(
        val lastApplied: Int,
        val received: Int,
    ) : SequenceOutcome
}

/**
 * Tracks the last applied realtime-event sequence number for one room and
 * classifies each incoming event. On a gap the caller is expected to request
 * a replay of missed events (the backend exposes this over the same
 * WebSocket connection via an `events.replay` message), apply them in order,
 * then call [fastForwardTo] with the highest sequence it applied.
 */
class RoomSequenceTracker(
    initialSequence: Int = 0,
) {
    var current: Int = initialSequence
        private set

    fun observe(sequence: Int): SequenceOutcome {
        if (sequence <= current) {
            return SequenceOutcome.DuplicateOrOld
        }
        if (sequence != current + 1) {
            return SequenceOutcome.GapDetected(lastApplied = current, received = sequence)
        }
        current = sequence
        return SequenceOutcome.Apply
    }

    fun fastForwardTo(sequence: Int) {
        if (sequence > current) current = sequence
    }
}
