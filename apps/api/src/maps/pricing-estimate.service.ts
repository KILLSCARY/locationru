import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PricingEstimateSchema,
  type PricingEstimate,
} from '@resilient-taxi/contracts';

@Injectable()
export class PricingEstimateService {
  constructor(private readonly config: ConfigService) {}

  calculate(distanceMeters: number, durationSeconds: number): PricingEstimate {
    assertNonnegativeInteger(distanceMeters, 'distanceMeters');
    assertNonnegativeInteger(durationSeconds, 'durationSeconds');
    const baseFare = this.value('baseFareKopecks');
    const distanceFare = divideRoundHalfUp(
      BigInt(distanceMeters) * BigInt(this.value('perKilometerKopecks')),
      1_000n,
    );
    const durationFare = divideRoundHalfUp(
      BigInt(durationSeconds) * BigInt(this.value('perMinuteKopecks')),
      60n,
    );
    const minimum = this.value('minimumFareKopecks');
    const recommended = Math.max(
      minimum,
      baseFare + distanceFare + durationFare,
    );
    const lower = Math.max(
      minimum,
      multiplyBasisPoints(
        recommended,
        this.value('lowerMultiplierBasisPoints'),
      ),
    );
    const upper = Math.max(
      recommended,
      multiplyBasisPoints(
        recommended,
        this.value('upperMultiplierBasisPoints'),
      ),
    );
    return PricingEstimateSchema.parse({
      recommendedPriceKopecks: recommended,
      minimumSuggestedPriceKopecks: lower,
      maximumSuggestedPriceKopecks: upper,
      distanceMeters,
      durationSeconds,
    });
  }

  private value(name: string): number {
    return this.config.getOrThrow<number>(`pricing.${name}`);
  }
}

export function multiplyBasisPoints(
  value: number,
  basisPoints: number,
): number {
  assertNonnegativeInteger(value, 'value');
  assertNonnegativeInteger(basisPoints, 'basisPoints');
  return divideRoundHalfUp(BigInt(value) * BigInt(basisPoints), 10_000n);
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): number {
  const result = (numerator + denominator / 2n) / denominator;
  const value = Number(result);
  if (!Number.isSafeInteger(value))
    throw new RangeError('Calculated price is outside the safe integer range');
  return value;
}

function assertNonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}
