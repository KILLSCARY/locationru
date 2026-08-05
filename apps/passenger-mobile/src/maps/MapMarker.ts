import type { GeoPoint } from '@/features/maps/types';

export type MapMarkerKind =
  | 'pickup'
  | 'destination'
  | 'waypoint'
  | 'driver'
  | 'user'
  | 'centerPin';

export type MapMarker = {
  id: string;
  kind: MapMarkerKind;
  location: GeoPoint;
  /** Heading in degrees, 0..360. Only meaningful for a moving marker (driver). */
  bearingDegrees?: number | null;
  label?: string;
};

export function pickupMarker(location: GeoPoint, label?: string): MapMarker {
  return { id: 'pickup', kind: 'pickup', location, label };
}

export function destinationMarker(
  location: GeoPoint,
  label?: string,
): MapMarker {
  return { id: 'destination', kind: 'destination', location, label };
}

export function driverMarker(
  location: GeoPoint,
  bearingDegrees: number | null,
): MapMarker {
  return { id: 'driver', kind: 'driver', location, bearingDegrees };
}

export function userMarker(location: GeoPoint): MapMarker {
  return { id: 'user', kind: 'user', location };
}
