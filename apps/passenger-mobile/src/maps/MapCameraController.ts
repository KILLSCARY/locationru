import type { GeoPoint } from '@/features/maps/types';
import { haversineMeters } from './geo';
import type { MapBounds } from './MapBounds';

export type CameraCommand =
  | { type: 'fitBounds'; bounds: MapBounds }
  | { type: 'focusPoint'; point: GeoPoint; zoom?: number }
  | { type: 'followDriver'; point: GeoPoint; bearingDegrees: number | null };

export type CameraControllerState = {
  lastCommand: CameraCommand | null;
  isFollowing: boolean;
};

export type CameraControllerOptions = {
  /** Re-centre only when the driver moved at least this far since the last render (metres). */
  minMoveMetersToRecenter: number;
  /** Re-centre only when bearing changed at least this much (degrees). */
  minBearingChangeDegrees: number;
};

export const DEFAULT_CAMERA_CONTROLLER_OPTIONS: CameraControllerOptions = {
  minMoveMetersToRecenter: 8,
  minBearingChangeDegrees: 12,
};

/**
 * Pure follow-mode state machine for the map camera. It never touches a
 * native map view directly — it decides *whether and how* the camera should
 * move, and the caller (a React hook wrapping the concrete map SDK) applies
 * the resulting `CameraCommand` to the view. Kept UI-framework-agnostic so
 * it is trivially unit-testable.
 */
export class MapCameraController {
  private state: CameraControllerState = {
    lastCommand: null,
    isFollowing: false,
  };
  private lastFollowedPoint: GeoPoint | null = null;
  private lastFollowedBearing: number | null = null;

  constructor(
    private readonly options: CameraControllerOptions = DEFAULT_CAMERA_CONTROLLER_OPTIONS,
  ) {}

  get isFollowing(): boolean {
    return this.state.isFollowing;
  }

  get lastCommand(): CameraCommand | null {
    return this.state.lastCommand;
  }

  fitRouteBounds(bounds: MapBounds): CameraCommand {
    const command: CameraCommand = { type: 'fitBounds', bounds };
    this.state = { lastCommand: command, isFollowing: false };
    return command;
  }

  focusPoint(point: GeoPoint, zoom?: number): CameraCommand {
    const command: CameraCommand = { type: 'focusPoint', point, zoom };
    this.state = { lastCommand: command, isFollowing: false };
    return command;
  }

  /** Enables follow mode and immediately centres on the driver. */
  startFollowingDriver(
    point: GeoPoint,
    bearingDegrees: number | null,
  ): CameraCommand {
    this.lastFollowedPoint = point;
    this.lastFollowedBearing = bearingDegrees;
    const command: CameraCommand = {
      type: 'followDriver',
      point,
      bearingDegrees,
    };
    this.state = { lastCommand: command, isFollowing: true };
    return command;
  }

  /**
   * Called on every driver position update while following. Returns a new
   * camera command only when the driver moved/turned enough to be worth a
   * re-centre — this is the "protection against constant sharp jumps": tiny
   * GPS jitter never re-triggers the native camera animation.
   */
  updateDriverPosition(
    point: GeoPoint,
    bearingDegrees: number | null,
  ): CameraCommand | null {
    if (!this.state.isFollowing) return null;

    const moved = this.lastFollowedPoint
      ? haversineMeters(this.lastFollowedPoint, point)
      : Number.POSITIVE_INFINITY;
    const turned =
      this.lastFollowedBearing !== null && bearingDegrees !== null
        ? Math.abs(angularDelta(this.lastFollowedBearing, bearingDegrees))
        : bearingDegrees !== null
          ? Number.POSITIVE_INFINITY
          : 0;

    if (
      moved < this.options.minMoveMetersToRecenter &&
      turned < this.options.minBearingChangeDegrees
    ) {
      return null;
    }

    this.lastFollowedPoint = point;
    this.lastFollowedBearing = bearingDegrees;
    const command: CameraCommand = {
      type: 'followDriver',
      point,
      bearingDegrees,
    };
    this.state = { lastCommand: command, isFollowing: true };
    return command;
  }

  /** Called when the user drags/zooms the map by hand. */
  onManualCameraMove(): void {
    this.state = { lastCommand: this.state.lastCommand, isFollowing: false };
  }

  /** "Return to follow mode" button — re-centres on the last known driver position. */
  resumeFollowing(): CameraCommand | null {
    if (!this.lastFollowedPoint) return null;
    return this.startFollowingDriver(
      this.lastFollowedPoint,
      this.lastFollowedBearing,
    );
  }
}

function angularDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}
