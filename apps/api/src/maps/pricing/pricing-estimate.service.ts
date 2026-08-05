import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PricingEstimate } from '../maps.types.js';

export interface PricingConfig {
  baseFareKopecks: number;
  perKilometerKopecks: number;
  perMinuteKopecks: number;
  minimumFareKopecks: number;
  lowerMultiplierBasisPoints: number;
  upperMultiplierBasisPoints: number;
}

const BASIS_POINTS_DENOMINATOR = 10_000;
const METERS_PER_KILOMETER = 1_000;
const SECONDS_PER_MINUTE = 60;

/**
 * Computes a *recommended* fare range shown to the passenger. It is a suggestion
 * only — the passenger may still name their own price as long as it clears the
 * system minimum. All arithmetic is integer kopecks to avoid float drift.
 */
@Injectable()
export class PricingEstimateService {
  constructor(private readonly configService: ConfigService) {}

  estimate(distanceMeters: number, durationSeconds: number): PricingEstimate {
    const config = this.load();
    return PricingEstimateService.compute(
      config,
      distanceMeters,
      durationSeconds,
    );
  }

  /** Pure computation, extracted so it is trivially unit-testable. */
  static compute(
    config: PricingConfig,
    distanceMeters: number,
    durationSeconds: number,
  ): PricingEstimate {
    const safeDistance = Math.max(0, Math.trunc(distanceMeters));
    const safeDuration = Math.max(0, Math.trunc(durationSeconds));

    // Integer kopecks throughout: multiply before dividing, then floor.
    const distanceCost = Math.floor(
      (safeDistance * config.perKilometerKopecks) / METERS_PER_KILOMETER,
    );
    const durationCost = Math.floor(
      (safeDuration * config.perMinuteKopecks) / SECONDS_PER_MINUTE,
    );

    const rawRecommended = config.baseFareKopecks + distanceCost + durationCost;
    const recommendedPriceKopecks = Math.max(
      rawRecommended,
      config.minimumFareKopecks,
    );

    const lowerBound = Math.floor(
      (recommendedPriceKopecks * config.lowerMultiplierBasisPoints) /
        BASIS_POINTS_DENOMINATOR,
    );
    const minimumSuggestedPriceKopecks = Math.max(
      lowerBound,
      config.minimumFareKopecks,
    );

    const maximumSuggestedPriceKopecks = Math.max(
      recommendedPriceKopecks,
      Math.floor(
        (recommendedPriceKopecks * config.upperMultiplierBasisPoints) /
          BASIS_POINTS_DENOMINATOR,
      ),
    );

    return {
      recommendedPriceKopecks,
      minimumSuggestedPriceKopecks,
      maximumSuggestedPriceKopecks,
      distanceMeters: safeDistance,
      durationSeconds: safeDuration,
    };
  }

  private load(): PricingConfig {
    return {
      baseFareKopecks: this.configService.getOrThrow<number>(
        'pricing.baseFareKopecks',
      ),
      perKilometerKopecks: this.configService.getOrThrow<number>(
        'pricing.perKilometerKopecks',
      ),
      perMinuteKopecks: this.configService.getOrThrow<number>(
        'pricing.perMinuteKopecks',
      ),
      minimumFareKopecks: this.configService.getOrThrow<number>(
        'pricing.minimumFareKopecks',
      ),
      lowerMultiplierBasisPoints: this.configService.getOrThrow<number>(
        'pricing.lowerMultiplierBasisPoints',
      ),
      upperMultiplierBasisPoints: this.configService.getOrThrow<number>(
        'pricing.upperMultiplierBasisPoints',
      ),
    };
  }
}
