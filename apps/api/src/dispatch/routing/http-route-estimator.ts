import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  RouteEstimate,
  RouteEstimator,
  RouteLeg,
} from './route-estimator.interface.js';

/**
 * Production-facing routing estimator scaffold.
 *
 * The transport (base URL, API key, timeout) is wired here. Unlike the payment
 * and SMS providers, an unavailable routing API is not fatal: dispatch degrades
 * gracefully to the straight-line ETA carried on each leg. Plug a concrete
 * routing API into {@link HttpRouteEstimator.fetchDurations} to enable
 * road-aware ETA.
 */
@Injectable()
export class HttpRouteEstimator implements RouteEstimator {
  readonly name = 'http';

  private readonly logger = new Logger(HttpRouteEstimator.name);
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    this.apiBaseUrl = config.getOrThrow<string>('dispatch.routingApiBaseUrl');
    this.apiKey = config.getOrThrow<string>('dispatch.routingApiKey');
    this.requestTimeoutMs = config.getOrThrow<number>(
      'dispatch.routingRequestTimeoutMs',
    );
  }

  async estimate(legs: RouteLeg[]): Promise<RouteEstimate[]> {
    if (legs.length === 0) {
      return [];
    }

    try {
      const durations = await this.fetchDurations(legs);
      return legs.map((leg) => ({
        driverId: leg.driverId,
        estimatedPickupSeconds:
          durations.get(leg.driverId) ?? leg.straightLineSeconds,
      }));
    } catch (error) {
      this.logger.warn(
        `Routing API unavailable, falling back to straight-line ETA: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return legs.map((leg) => ({
        driverId: leg.driverId,
        estimatedPickupSeconds: leg.straightLineSeconds,
      }));
    }
  }

  /**
   * Resolves road-aware pickup durations per driver. Not wired to a concrete
   * routing API yet; build the request via {@link HttpRouteEstimator.request}
   * and map the response into driverId -> seconds.
   */
  private async fetchDurations(legs: RouteLeg[]): Promise<Map<string, number>> {
    void legs;
    throw new NotImplementedException({
      code: 'ROUTING_PROVIDER_NOT_IMPLEMENTED',
      message: 'HttpRouteEstimator.fetchDurations is not wired to an API yet',
    });
  }

  /**
   * Authenticated JSON request against the routing API. The concrete
   * `fetchDurations` implementation builds on this helper once the API is
   * chosen.
   */
  protected async request<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Routing API responded with ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
