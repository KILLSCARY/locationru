import type { GeoPoint } from '@/features/maps/types';

export type MapPolylineKind = 'route' | 'traveled' | 'remaining';

export type MapPolyline = {
  id: string;
  kind: MapPolylineKind;
  points: GeoPoint[];
};

export function routePolyline(points: GeoPoint[]): MapPolyline {
  return { id: 'route', kind: 'route', points };
}

export function traveledPolyline(points: GeoPoint[]): MapPolyline {
  return { id: 'traveled', kind: 'traveled', points };
}

export function remainingPolyline(points: GeoPoint[]): MapPolyline {
  return { id: 'remaining', kind: 'remaining', points };
}

/**
 * Structural equality for two polylines' point arrays. Used to skip
 * re-creating a rendered polyline (and the underlying native view) when a new
 * route estimate is byte-for-byte the same as the one already drawn.
 */
export function polylinePointsEqual(a: GeoPoint[], b: GeoPoint[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (point, index) =>
      point.latitude === b[index]?.latitude &&
      point.longitude === b[index]?.longitude,
  );
}
