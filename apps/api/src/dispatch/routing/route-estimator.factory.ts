import { ConfigService } from '@nestjs/config';

import { HttpRouteEstimator } from './http-route-estimator.js';
import type { RouteEstimator } from './route-estimator.interface.js';
import { StraightLineRouteEstimator } from './straight-line-route-estimator.js';

/**
 * Selects the route estimator from configuration. Straight-line is the default
 * and a valid production model, so it is not restricted by environment.
 */
export function createRouteEstimator(config: ConfigService): RouteEstimator {
  const provider = config.getOrThrow<'straight-line' | 'http'>(
    'dispatch.routingProvider',
  );

  if (provider === 'http') {
    return new HttpRouteEstimator(config);
  }

  return new StraightLineRouteEstimator();
}
