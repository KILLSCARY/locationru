export type SequenceOutcome =
  | { type: 'apply' }
  | { type: 'duplicate_or_old' }
  | { type: 'gap_detected'; lastApplied: number; received: number };

/**
 * Tracks the last applied `RealtimeEventEnvelope.sequence` for one room and
 * classifies each incoming event. On a gap the caller is expected to call
 * `events.replay` (a WebSocket message the backend already exposes) with
 * `afterSequence: lastApplied`, apply the returned events in order, then call
 * `fastForwardTo` with the highest sequence it applied.
 */
export class RoomSequenceTracker {
  private lastApplied: number;

  constructor(initialSequence = 0) {
    this.lastApplied = initialSequence;
  }

  get current(): number {
    return this.lastApplied;
  }

  observe(sequence: number): SequenceOutcome {
    if (sequence <= this.lastApplied) {
      return { type: 'duplicate_or_old' };
    }
    if (sequence !== this.lastApplied + 1) {
      return {
        type: 'gap_detected',
        lastApplied: this.lastApplied,
        received: sequence,
      };
    }
    this.lastApplied = sequence;
    return { type: 'apply' };
  }

  fastForwardTo(sequence: number): void {
    if (sequence > this.lastApplied) {
      this.lastApplied = sequence;
    }
  }
}
