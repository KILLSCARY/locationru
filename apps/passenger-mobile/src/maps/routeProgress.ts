import type { GeoPoint } from '@/features/maps/types';
import { haversineMeters, lerpPoint, projectOntoSegment } from './geo';

export type RouteProgress = {
  /** Route geometry from its start up to the car's projected position. */
  traveled: GeoPoint[];
  /** Route geometry from the car's projected position to the end. */
  remaining: GeoPoint[];
  /** Index of the geometry segment the car is currently on. */
  segmentIndex: number;
  /** Perpendicular distance from the car to the route, in metres. */
  distanceFromRouteMeters: number;
};

/**
 * Splits `geometry` into a traveled and a remaining polyline based on where
 * `currentPosition` projects onto it — used to render "driven so far" vs
 * "still to go" as two differently-styled polylines. Falls back to treating
 * the whole route as remaining when the geometry has fewer than two points.
 */
export function computeRouteProgress(
  geometry: GeoPoint[],
  currentPosition: GeoPoint,
): RouteProgress {
  if (geometry.length < 2) {
    return {
      traveled: [],
      remaining: geometry,
      segmentIndex: 0,
      distanceFromRouteMeters: geometry[0]
        ? haversineMeters(geometry[0], currentPosition)
        : 0,
    };
  }

  let bestSegmentIndex = 0;
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProjected: GeoPoint = geometry[0]!;

  for (let index = 0; index < geometry.length - 1; index += 1) {
    const a = geometry[index]!;
    const b = geometry[index + 1]!;
    const { projected, t } = projectOntoSegment(currentPosition, a, b);
    const distance = haversineMeters(currentPosition, projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSegmentIndex = index;
      bestT = t;
      bestProjected = projected;
    }
  }

  const traveled = [
    ...geometry.slice(0, bestSegmentIndex + 1),
    ...(bestT > 0 ? [bestProjected] : []),
  ];
  const remaining = [
    ...(bestT < 1 ? [bestProjected] : []),
    ...geometry.slice(bestSegmentIndex + 1),
  ];

  return {
    traveled,
    remaining,
    segmentIndex: bestSegmentIndex,
    distanceFromRouteMeters: bestDistance,
  };
}

/** Total length in metres along an ordered polyline. */
export function polylineLengthMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMeters(points[index - 1]!, points[index]!);
  }
  return total;
}

/** Approximate remaining distance in metres given the current route progress. */
export function remainingDistanceMeters(progress: RouteProgress): number {
  return polylineLengthMeters(progress.remaining);
}

/**
 * A point on the route a given distance ahead of `from` — used by
 * development tooling (the trip simulator) to advance a fake driver smoothly
 * along route geometry rather than jumping between geometry vertices.
 */
export function advanceAlongRoute(
  geometry: GeoPoint[],
  fromIndex: number,
  distanceMeters: number,
): { point: GeoPoint; index: number } {
  let remaining = distanceMeters;
  let index = Math.max(0, Math.min(fromIndex, geometry.length - 2));

  while (index < geometry.length - 1) {
    const segmentLength = haversineMeters(
      geometry[index]!,
      geometry[index + 1]!,
    );
    if (segmentLength >= remaining) {
      const t = segmentLength === 0 ? 1 : remaining / segmentLength;
      return {
        point: lerpPoint(geometry[index]!, geometry[index + 1]!, t),
        index,
      };
    }
    remaining -= segmentLength;
    index += 1;
  }

  return { point: geometry[geometry.length - 1]!, index: geometry.length - 2 };
}
