import { ConfigService } from '@nestjs/config';

import {
  PricingEstimateService,
  type PricingConfig,
} from './pricing-estimate.service.js';

const config: PricingConfig = {
  baseFareKopecks: 15_000,
  perKilometerKopecks: 3_000,
  perMinuteKopecks: 800,
  minimumFareKopecks: 15_000,
  lowerMultiplierBasisPoints: 9_000,
  upperMultiplierBasisPoints: 13_000,
};

describe('PricingEstimateService.compute', () => {
  it('computes an integer recommended price from distance and duration', () => {
    // 4200m -> 4.2km * 3000 = 12600 (floored); 540s -> 9min * 800 = 7200
    const result = PricingEstimateService.compute(config, 4_200, 540);
    expect(result.recommendedPriceKopecks).toBe(15_000 + 12_600 + 7_200);
    expect(Number.isInteger(result.recommendedPriceKopecks)).toBe(true);
  });

  it('never recommends below the minimum fare', () => {
    const lowBaseFareConfig: PricingConfig = {
      ...config,
      baseFareKopecks: 1_000,
      minimumFareKopecks: 5_000,
    };
    const result = PricingEstimateService.compute(lowBaseFareConfig, 0, 0);
    expect(result.recommendedPriceKopecks).toBe(
      lowBaseFareConfig.minimumFareKopecks,
    );
  });

  it('keeps the minimum suggested price at or above the minimum fare', () => {
    const result = PricingEstimateService.compute(config, 100, 60);
    expect(result.minimumSuggestedPriceKopecks).toBeGreaterThanOrEqual(
      config.minimumFareKopecks,
    );
  });

  it('keeps the maximum suggested price at or above the recommended price', () => {
    const result = PricingEstimateService.compute(config, 4_200, 540);
    expect(result.maximumSuggestedPriceKopecks).toBeGreaterThanOrEqual(
      result.recommendedPriceKopecks,
    );
  });

  it('produces only integer kopecks across all fields', () => {
    const result = PricingEstimateService.compute(config, 12_345, 987);
    expect(Number.isInteger(result.recommendedPriceKopecks)).toBe(true);
    expect(Number.isInteger(result.minimumSuggestedPriceKopecks)).toBe(true);
    expect(Number.isInteger(result.maximumSuggestedPriceKopecks)).toBe(true);
  });

  it('truncates fractional or negative distance/duration input defensively', () => {
    const result = PricingEstimateService.compute(config, -5, 60.9);
    expect(result.distanceMeters).toBe(0);
    expect(result.durationSeconds).toBe(60);
  });
});

describe('PricingEstimateService', () => {
  it('reads configuration and delegates to the pure calculator', () => {
    const service = new PricingEstimateService(
      new ConfigService({ pricing: config }),
    );
    const result = service.estimate(4_200, 540);
    expect(result).toEqual(PricingEstimateService.compute(config, 4_200, 540));
  });
});
