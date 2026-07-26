import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { FareCalculator } from './fare-calculator.service.js';

class CommissionLookupPrisma {
  readonly cityRates = new Map<string, number>();
  readonly driverRates = new Map<string, number | null>();

  readonly cityCommissionRate = {
    findUnique: async ({ where }: { where: { cityCode: string } }) => {
      const commissionBasisPoints = this.cityRates.get(where.cityCode);
      return commissionBasisPoints === undefined
        ? null
        : { commissionBasisPoints };
    },
  };

  readonly driverProfile = {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      if (!this.driverRates.has(where.userId)) return null;
      return { commissionBasisPoints: this.driverRates.get(where.userId) };
    },
  };
}

describe('FareCalculator', () => {
  it('calculates an 8% commission in integer kopecks', () => {
    const calculator = calculatorWith({ minimumCommissionKopecks: 0 });

    expect(calculator.calculate(10_001, 800)).toEqual({
      totalKopecks: 10_001,
      commissionBasisPoints: 800,
      commissionKopecks: 800,
      driverPayoutKopecks: 9_201,
    });
  });

  it('applies the configured minimum commission without exceeding the total', () => {
    const calculator = calculatorWith({ minimumCommissionKopecks: 50 });

    expect(calculator.calculate(100, 800)).toMatchObject({
      commissionKopecks: 50,
      driverPayoutKopecks: 50,
    });
    expect(calculator.calculate(30, 800)).toMatchObject({
      commissionKopecks: 30,
      driverPayoutKopecks: 0,
    });
  });

  it('preserves the accounting invariant on boundary amounts and rates', () => {
    const calculator = calculatorWith({ minimumCommissionKopecks: 1 });
    const totals = [0, 1, 2, 99, 100, 101, 9_999, 10_000, 2_147_483_647];
    const rates = [0, 1, 799, 800, 9_999, 10_000];

    for (const total of totals) {
      for (const rate of rates) {
        const fare = calculator.calculate(total, rate);
        expect(fare.commissionKopecks + fare.driverPayoutKopecks).toBe(total);
        expect(fare.commissionKopecks).toBeGreaterThanOrEqual(0);
        expect(fare.commissionKopecks).toBeLessThanOrEqual(total);
        expect(fare.driverPayoutKopecks).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('resolves individual, city and global rates in priority order', async () => {
    const lookup = new CommissionLookupPrisma();
    lookup.driverRates.set('driver-individual', 1_200);
    lookup.driverRates.set('driver-city', null);
    lookup.cityRates.set('MSK', 900);
    const calculator = calculatorWith({ globalCommissionBasisPoints: 800 });

    await expect(
      calculator.calculateForDriver(
        {
          driverId: 'driver-individual',
          cityCode: 'msk',
          totalKopecks: 10_000,
        },
        lookup as unknown as PrismaService,
      ),
    ).resolves.toMatchObject({
      commissionBasisPoints: 1_200,
      commissionKopecks: 1_200,
    });
    await expect(
      calculator.calculateForDriver(
        { driverId: 'driver-city', cityCode: 'msk', totalKopecks: 10_000 },
        lookup as unknown as PrismaService,
      ),
    ).resolves.toMatchObject({
      commissionBasisPoints: 900,
      commissionKopecks: 900,
    });
    await expect(
      calculator.calculateForDriver(
        { driverId: 'driver-global', cityCode: 'spb', totalKopecks: 10_000 },
        lookup as unknown as PrismaService,
      ),
    ).resolves.toMatchObject({
      commissionBasisPoints: 800,
      commissionKopecks: 800,
    });
  });
});

function calculatorWith(overrides: {
  globalCommissionBasisPoints?: number;
  minimumCommissionKopecks?: number;
}): FareCalculator {
  return new FareCalculator(
    new ConfigService({
      finance: {
        globalCommissionBasisPoints:
          overrides.globalCommissionBasisPoints ?? 800,
        minimumCommissionKopecks: overrides.minimumCommissionKopecks ?? 0,
      },
    }),
    {} as PrismaService,
  );
}
