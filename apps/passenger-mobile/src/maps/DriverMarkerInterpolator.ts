import type { GeoPoint } from '@/features/maps/types';
import { haversineMeters, lerpBearing, lerpPoint } from './geo';

export type DriverLocationSample = {
  location: GeoPoint;
  bearingDegrees: number | null;
  /** ISO-8601 timestamp from the server (when the GPS fix was taken). */
  recordedAt: string;
};

export type InterpolatorOptions = {
  /** Animation duration for a "normal" update, in ms (MAP_DRIVER_INTERPOLATION_MS). */
  defaultDurationMs: number;
  /** Never animate longer than this, however large the gap between updates. */
  maxDurationMs: number;
  /** A jump implying more speed than this (m/s) is rejected as implausible. */
  maxPlausibleSpeedMetersPerSecond: number;
};

export const DEFAULT_INTERPOLATOR_OPTIONS: InterpolatorOptions = {
  defaultDurationMs: Number(
    process.env.EXPO_PUBLIC_MAP_DRIVER_INTERPOLATION_MS ?? 1_000,
  ),
  maxDurationMs: 5_000,
  maxPlausibleSpeedMetersPerSecond: 55, // ~200 km/h
};

export type IngestOutcome =
  | 'accepted'
  | 'stale_ignored'
  | 'implausible_speed_ignored';

type Keyframe = {
  location: GeoPoint;
  bearingDegrees: number | null;
  recordedAtMs: number;
};

/**
 * Smooths driver marker updates so the marker glides between GPS fixes
 * instead of teleporting on every WebSocket update. Two rejection rules keep
 * the render honest: a sample older than (or equal to) the current target's
 * recordedAt never moves the marker backward without cause, and a sample that
 * implies an impossible speed is rejected outright (kept for the caller to
 * treat as SPOOFING_SUSPECTED via `locationQuality`).
 *
 * Callers ingest server updates via `ingest`, then sample the interpolated
 * render position every frame via `positionAt(nowMs)` — nowMs is always
 * caller-supplied so this class has no hidden clock dependency and is fully
 * deterministic in tests.
 */
export class DriverMarkerInterpolator {
  private from: Keyframe | null = null;
  private to: Keyframe | null = null;
  private animStartMs = 0;
  private animDurationMs = 0;

  constructor(
    private readonly options: InterpolatorOptions = DEFAULT_INTERPOLATOR_OPTIONS,
  ) {}

  ingest(sample: DriverLocationSample, receivedAtMs: number): IngestOutcome {
    const recordedAtMs = Date.parse(sample.recordedAt);

    if (this.to && recordedAtMs <= this.to.recordedAtMs) {
      return 'stale_ignored';
    }

    if (this.to) {
      const elapsedSeconds = (recordedAtMs - this.to.recordedAtMs) / 1_000;
      const distanceMeters = haversineMeters(this.to.location, sample.location);
      const impliedSpeed =
        elapsedSeconds > 0 ? distanceMeters / elapsedSeconds : Infinity;
      if (impliedSpeed > this.options.maxPlausibleSpeedMetersPerSecond) {
        return 'implausible_speed_ignored';
      }
    }

    // The new animation starts from wherever the marker currently sits, so a
    // fast-arriving update never causes a visible snap back to `to`.
    this.from = this.to
      ? { ...this.currentRenderKeyframe(receivedAtMs) }
      : {
          location: sample.location,
          bearingDegrees: sample.bearingDegrees,
          recordedAtMs,
        };

    const previousRecordedAtMs = this.to?.recordedAtMs ?? recordedAtMs;
    const gapMs = recordedAtMs - previousRecordedAtMs;
    this.animDurationMs =
      gapMs > 0
        ? Math.min(gapMs, this.options.maxDurationMs)
        : this.options.defaultDurationMs;
    this.animStartMs = receivedAtMs;
    this.to = {
      location: sample.location,
      bearingDegrees: sample.bearingDegrees,
      recordedAtMs,
    };

    return 'accepted';
  }

  /** The interpolated position to render at wall-clock time `nowMs`. */
  positionAt(nowMs: number): {
    location: GeoPoint;
    bearingDegrees: number | null;
  } {
    if (!this.to) {
      return { location: { latitude: 0, longitude: 0 }, bearingDegrees: null };
    }
    if (!this.from) {
      return {
        location: this.to.location,
        bearingDegrees: this.to.bearingDegrees,
      };
    }

    const t =
      this.animDurationMs <= 0
        ? 1
        : Math.max(
            0,
            Math.min(1, (nowMs - this.animStartMs) / this.animDurationMs),
          );

    return {
      location: lerpPoint(this.from.location, this.to.location, t),
      bearingDegrees: lerpBearing(
        this.from.bearingDegrees,
        this.to.bearingDegrees,
        t,
      ),
    };
  }

  /** True once at least one sample has been accepted. */
  hasPosition(): boolean {
    return this.to !== null;
  }

  private currentRenderKeyframe(nowMs: number): Keyframe {
    const rendered = this.positionAt(nowMs);
    return {
      location: rendered.location,
      bearingDegrees: rendered.bearingDegrees,
      recordedAtMs: this.to?.recordedAtMs ?? nowMs,
    };
  }
}
