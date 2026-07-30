import type { GeoPoint } from '@/features/maps/types';

export type MapBounds = {
  minLatitude: number;
  minLongitude: number;
  maxLatitude: number;
  maxLongitude: number;
};

/** Axis-aligned bounding box covering every point. Throws on an empty list. */
export function boundsOfPoints(points: GeoPoint[]): MapBounds {
  if (points.length === 0) {
    throw new Error('boundsOfPoints requires at least one point');
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

/** Combines two bounding boxes into the smallest box covering both. */
export function unionBounds(a: MapBounds, b: MapBounds): MapBounds {
  return {
    minLatitude: Math.min(a.minLatitude, b.minLatitude),
    minLongitude: Math.min(a.minLongitude, b.minLongitude),
    maxLatitude: Math.max(a.maxLatitude, b.maxLatitude),
    maxLongitude: Math.max(a.maxLongitude, b.maxLongitude),
  };
}

/** Expands a box by `ratio` of its own size on every side (e.g. 0.15 = 15% padding). */
export function padBounds(bounds: MapBounds, ratio: number): MapBounds {
  const latSpan = bounds.maxLatitude - bounds.minLatitude || 0.001;
  const lonSpan = bounds.maxLongitude - bounds.minLongitude || 0.001;
  return {
    minLatitude: bounds.minLatitude - latSpan * ratio,
    minLongitude: bounds.minLongitude - lonSpan * ratio,
    maxLatitude: bounds.maxLatitude + latSpan * ratio,
    maxLongitude: bounds.maxLongitude + lonSpan * ratio,
  };
}

export function boundsCenter(bounds: MapBounds): GeoPoint {
  return {
    latitude: (bounds.minLatitude + bounds.maxLatitude) / 2,
    longitude: (bounds.minLongitude + bounds.maxLongitude) / 2,
  };
}

export function containsPoint(bounds: MapBounds, point: GeoPoint): boolean {
  return (
    point.latitude >= bounds.minLatitude &&
    point.latitude <= bounds.maxLatitude &&
    point.longitude >= bounds.minLongitude &&
    point.longitude <= bounds.maxLongitude
  );
}
