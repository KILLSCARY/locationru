import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { DuplicateMatchResult } from '../generated/prisma/client.js';

type SignalCategory = 'DOCUMENT_NUMBER' | 'VEHICLE_IDENTIFIER' | 'DEVICE';

export interface DuplicateSignalMatch {
  category: SignalCategory;
  otherDriverId: string;
}

export interface DuplicateCheckResult {
  result: DuplicateMatchResult;
  matches: DuplicateSignalMatch[];
  checkedAt: string;
}

/**
 * Task 29 section 19. Phone numbers are already unique at the DB level
 * (User.phone), so they are not a duplicate *signal* here — this service
 * looks for the fraud pattern a unique constraint can't catch: the same
 * person (same passport/license number, same vehicle, or same physical
 * device) registering under a second driver account. It never blocks
 * anything itself; it only classifies the evidence for a human admin (see
 * VerificationSubmissionService, which stores the result on
 * VerificationCase.duplicateCheckResult) — see docs/drivers/verification.md.
 */
@Injectable()
export class DriverDuplicateDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  async checkForDuplicates(driverId: string): Promise<DuplicateCheckResult> {
    const matches: DuplicateSignalMatch[] = [
      ...(await this.matchDocumentNumbers(driverId)),
      ...(await this.matchVehicleIdentifiers(driverId)),
      ...(await this.matchDevices(driverId)),
    ];

    return {
      result: this.classify(matches),
      matches,
      checkedAt: new Date().toISOString(),
    };
  }

  /** Never STRONG_MATCH from a single signal category, and MANUAL_REVIEW_REQUIRED whenever the evidence points at more than one other driver rather than a single clear candidate. */
  private classify(matches: DuplicateSignalMatch[]): DuplicateMatchResult {
    if (matches.length === 0) return DuplicateMatchResult.NO_MATCH;

    const otherDriverIds = new Set(matches.map((match) => match.otherDriverId));
    if (otherDriverIds.size > 1) {
      return DuplicateMatchResult.MANUAL_REVIEW_REQUIRED;
    }

    const categoriesForTheOtherDriver = new Set(
      matches.map((match) => match.category),
    );
    return categoriesForTheOtherDriver.size >= 2
      ? DuplicateMatchResult.STRONG_MATCH
      : DuplicateMatchResult.POSSIBLE_MATCH;
  }

  private async matchDocumentNumbers(
    driverId: string,
  ): Promise<DuplicateSignalMatch[]> {
    const ownDocuments = await this.prisma.driverDocument.findMany({
      where: { driverId, documentNumberHash: { not: null } },
      select: { documentNumberHash: true },
    });
    const hashes = ownDocuments
      .map((doc) => doc.documentNumberHash)
      .filter((hash): hash is string => hash !== null);
    if (hashes.length === 0) return [];

    const others = await this.prisma.driverDocument.findMany({
      where: {
        driverId: { not: driverId },
        documentNumberHash: { in: hashes },
      },
      select: { driverId: true },
    });
    return others.map((doc) => ({
      category: 'DOCUMENT_NUMBER' as const,
      otherDriverId: doc.driverId,
    }));
  }

  private async matchVehicleIdentifiers(
    driverId: string,
  ): Promise<DuplicateSignalMatch[]> {
    const ownVehicles = await this.prisma.vehicle.findMany({
      where: { driverId },
      select: { vinHash: true, registrationNumberHash: true },
    });
    const vinHashes = ownVehicles
      .map((vehicle) => vehicle.vinHash)
      .filter((hash): hash is string => hash !== null);
    const registrationHashes = ownVehicles.map(
      (vehicle) => vehicle.registrationNumberHash,
    );
    if (vinHashes.length === 0 && registrationHashes.length === 0) return [];

    const others = await this.prisma.vehicle.findMany({
      where: {
        driverId: { not: driverId },
        OR: [
          ...(vinHashes.length ? [{ vinHash: { in: vinHashes } }] : []),
          { registrationNumberHash: { in: registrationHashes } },
        ],
      },
      select: { driverId: true },
    });
    return others.map((vehicle) => ({
      category: 'VEHICLE_IDENTIFIER' as const,
      otherDriverId: vehicle.driverId,
    }));
  }

  private async matchDevices(
    driverId: string,
  ): Promise<DuplicateSignalMatch[]> {
    const ownDeviceIds = await this.prisma.deviceSession.findMany({
      where: { userId: driverId },
      select: { deviceId: true },
      distinct: ['deviceId'],
    });
    if (ownDeviceIds.length === 0) return [];

    const others = await this.prisma.deviceSession.findMany({
      where: {
        userId: { not: driverId },
        deviceId: { in: ownDeviceIds.map((session) => session.deviceId) },
        user: { role: 'DRIVER' as never },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return others.map((session) => ({
      category: 'DEVICE' as const,
      otherDriverId: session.userId,
    }));
  }
}
