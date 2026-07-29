import type { GeoBounds, GeoPoint } from '../maps.types.js';

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in metres between two points (haversine). Used by the
 * development provider and as a floor for degenerate routes.
 */
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

/** Total length in metres along an ordered polyline. */
export function polylineLengthMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMeters(points[index - 1]!, points[index]!);
  }
  return total;
}

/** Axis-aligned bounding box covering every point. */
export function boundsOf(points: GeoPoint[]): GeoBounds {
  if (points.length === 0) {
    throw new Error('boundsOf requires at least one point');
  }

  let minLatitude = Number.POSITIVE_INFINITY;
  let minLongitude = Number.POSITIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }

  return { minLatitude, minLongitude, maxLatitude, maxLongitude };
}

/** Rounds a coordinate to ~1.1 m precision for stable cache keys. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
