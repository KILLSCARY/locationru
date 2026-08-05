export interface GeoPoint {
  longitude: number;
  latitude: number;
}

export interface RouteLeg {
  driverId: string;
  /** Pickup ETA from the straight-line geodesic model, used as the fallback. */
  straightLineSeconds: number;
  /** Driver position. */
  origin: GeoPoint;
  /** Trip pickup position. */
  destination: GeoPoint;
}

export interface RouteEstimate {
  driverId: string;
  estimatedPickupSeconds: number;
}

/**
 * Refines pickup ETA for dispatch candidates. The geospatial candidate search
 * (radius filter + straight-line ETA) stays in SQL as a cheap pre-filter; an
 * estimator then refines the ETA for the shortlisted candidates.
 */
export interface RouteEstimator {
  readonly name: string;
  estimate(legs: RouteLeg[]): Promise<RouteEstimate[]>;
}

export const ROUTE_ESTIMATOR = Symbol('ROUTE_ESTIMATOR');
