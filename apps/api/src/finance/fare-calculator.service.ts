import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface FareCalculation {
  commissionBasisPoints: number;
  commissionKopecks: number;
  driverPayoutKopecks: number;
  totalKopecks: number;
}

export interface FareCalculationRequest {
  cityCode?: string | null;
  driverId: string;
  totalKopecks: number;
}

type CommissionLookupClient =
  | Pick<Prisma.TransactionClient, 'cityCommissionRate' | 'driverProfile'>
  | PrismaService;

@Injectable()
export class FareCalculator {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  calculate(
    totalKopecks: number,
    commissionBasisPoints: number,
  ): FareCalculation {
    this.assertKopecks(totalKopecks, 'totalKopecks');
    this.assertBasisPoints(commissionBasisPoints);
    const minimumCommissionKopecks = this.configService.getOrThrow<number>(
      'finance.minimumCommissionKopecks',
    );
    this.assertKopecks(minimumCommissionKopecks, 'minimumCommissionKopecks');

    const percentageCommission = Math.floor(
      (totalKopecks * commissionBasisPoints) / 10_000,
    );
    const commissionKopecks = Math.min(
      totalKopecks,
      Math.max(minimumCommissionKopecks, percentageCommission),
    );

    return {
      totalKopecks,
      commissionBasisPoints,
      commissionKopecks,
      driverPayoutKopecks: totalKopecks - commissionKopecks,
    };
  }

  async calculateForDriver(
    request: FareCalculationRequest,
    client: CommissionLookupClient = this.prisma,
  ): Promise<FareCalculation> {
    const commissionBasisPoints = await this.resolveCommissionBasisPoints(
      request.driverId,
      request.cityCode,
      client,
    );

    return this.calculate(request.totalKopecks, commissionBasisPoints);
  }

  async resolveCommissionBasisPoints(
    driverId: string,
    cityCode: string | null | undefined,
    client: CommissionLookupClient = this.prisma,
  ): Promise<number> {
    const driver = await client.driverProfile.findUnique({
      where: { userId: driverId },
      select: { commissionBasisPoints: true },
    });

    if (
      driver?.commissionBasisPoints !== null &&
      driver?.commissionBasisPoints !== undefined
    ) {
      return driver.commissionBasisPoints;
    }

    const normalizedCityCode = cityCode?.trim().toUpperCase();
    if (normalizedCityCode) {
      const cityRate = await client.cityCommissionRate.findUnique({
        where: { cityCode: normalizedCityCode },
        select: { commissionBasisPoints: true },
      });
      if (cityRate) return cityRate.commissionBasisPoints;
    }

    return this.configService.getOrThrow<number>(
      'finance.globalCommissionBasisPoints',
    );
  }

  private assertKopecks(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException({
        code: 'INVALID_KOPECKS_AMOUNT',
        message: `${field} must be a non-negative safe integer number of kopecks`,
      });
    }
  }

  private assertBasisPoints(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
      throw new BadRequestException({
        code: 'INVALID_COMMISSION_BASIS_POINTS',
        message: 'Commission basis points must be an integer from 0 to 10000',
      });
    }
  }
}
