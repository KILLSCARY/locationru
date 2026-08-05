import { ConfigService } from '@nestjs/config';

import {
  multiplyBasisPoints,
  PricingEstimateService,
} from './pricing-estimate.service.js';

describe('PricingEstimateService', () => {
  const service = new PricingEstimateService(
    new ConfigService({
      pricing: {
        baseFareKopecks: 10_000,
        perKilometerKopecks: 2_000,
        perMinuteKopecks: 300,
        minimumFareKopecks: 15_000,
        lowerMultiplierBasisPoints: 9_000,
        upperMultiplierBasisPoints: 12_000,
      },
    }),
  );

  it('uses integer arithmetic and half-up rounding', () => {
    expect(service.calculate(1_500, 90)).toEqual({
      recommendedPriceKopecks: 15_000,
      minimumSuggestedPriceKopecks: 15_000,
      maximumSuggestedPriceKopecks: 18_000,
      distanceMeters: 1_500,
      durationSeconds: 90,
    });
    expect(multiplyBasisPoints(145_000, 8_000)).toBe(116_000);
    expect(multiplyBasisPoints(1, 5_000)).toBe(1);
  });

  it.each([
    [0, 0],
    [1, 1],
    [999, 59],
    [1_000_000, 86_400],
  ])(
    'keeps bounds ordered for distance %i and duration %i',
    (distance, duration) => {
      const result = service.calculate(distance, duration);
      expect(result.minimumSuggestedPriceKopecks).toBeLessThanOrEqual(
        result.recommendedPriceKopecks,
      );
      expect(result.maximumSuggestedPriceKopecks).toBeGreaterThanOrEqual(
        result.recommendedPriceKopecks,
      );
    },
  );
});
