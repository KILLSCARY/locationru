import type { GeoPoint } from '@/features/maps/types';

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres between two points (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Linear interpolation between two points in an equirectangular projection
 * (longitude scaled by cos(latitude)). Accurate enough at city scale for
 * marker animation and route-progress projection; not for long-haul geodesy.
 */
export function lerpPoint(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * clamped,
    longitude: a.longitude + (b.longitude - a.longitude) * clamped,
  };
}

/** Shortest-path interpolation between two bearings (handles the 0/360 wrap). */
export function lerpBearing(
  a: number | null,
  b: number | null,
  t: number,
): number | null {
  if (a === null) return b;
  if (b === null) return a;
  const clamped = Math.max(0, Math.min(1, t));
  const delta = ((b - a + 540) % 360) - 180;
  const result = a + delta * clamped;
  return ((result % 360) + 360) % 360;
}

/**
 * Compass bearing in degrees (0..360, 0 = north) from `a` to `b`. The backend
 * does not send a bearing on driver.location.updated, so the client derives
 * one from consecutive raw samples to orient the car marker.
 */
export function bearingBetween(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/** Projects `point` onto the segment a→b; returns the projection and its t in [0, 1]. */
export function projectOntoSegment(
  point: GeoPoint,
  a: GeoPoint,
  b: GeoPoint,
): { projected: GeoPoint; t: number } {
  const latScale = Math.cos(toRadians((a.latitude + b.latitude) / 2)) || 1e-9;
  const ax = a.longitude * latScale;
  const ay = a.latitude;
  const bx = b.longitude * latScale;
  const by = b.latitude;
  const px = point.longitude * latScale;
  const py = point.latitude;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
        );

  return {
    projected: {
      latitude: ay + dy * t,
      longitude: (ax + dx * t) / latScale,
    },
    t,
  };
}
