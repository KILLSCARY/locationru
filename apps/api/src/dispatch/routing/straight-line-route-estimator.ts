import { Injectable } from '@nestjs/common';

import type {
  RouteEstimate,
  RouteEstimator,
  RouteLeg,
} from './route-estimator.interface.js';

/**
 * Default estimator: keeps the straight-line geodesic ETA computed in SQL. It
 * ignores the road network, traffic and turn restrictions — the temporary
 * model documented in docs/architecture/dispatch.md.
 */
@Injectable()
export class StraightLineRouteEstimator implements RouteEstimator {
  readonly name = 'straight-line';

  async estimate(legs: RouteLeg[]): Promise<RouteEstimate[]> {
    return legs.map((leg) => ({
      driverId: leg.driverId,
      estimatedPickupSeconds: leg.straightLineSeconds,
    }));
  }
}
