import { PrismaService } from '../database/prisma.service.js';
import { DuplicateMatchResult } from '../generated/prisma/client.js';
import { DriverDuplicateDetectionService } from './driver-duplicate-detection.service.js';

const DRIVER_ID = 'driver-1';
const OTHER_DRIVER_ID = 'driver-2';

class InMemoryPrisma {
  driverDocuments: Array<{
    driverId: string;
    documentNumberHash: string | null;
  }> = [];
  vehicles: Array<{
    driverId: string;
    vinHash: string | null;
    registrationNumberHash: string;
  }> = [];
  deviceSessions: Array<{ userId: string; deviceId: string; role: string }> =
    [];

  readonly driverDocument = {
    findMany: async ({
      where,
    }: {
      where: {
        driverId?: string | { not: string };
        documentNumberHash?: { not: null } | { in: string[] };
      };
    }) =>
      this.driverDocuments.filter((doc) => {
        if (
          typeof where.driverId === 'string' &&
          doc.driverId !== where.driverId
        )
          return false;
        if (
          where.driverId &&
          typeof where.driverId === 'object' &&
          'not' in where.driverId &&
          doc.driverId === where.driverId.not
        )
          return false;
        if (where.documentNumberHash && 'in' in where.documentNumberHash) {
          if (!doc.documentNumberHash) return false;
          if (!where.documentNumberHash.in.includes(doc.documentNumberHash))
            return false;
        }
        if (where.documentNumberHash && 'not' in where.documentNumberHash) {
          if (doc.documentNumberHash === null) return false;
        }
        return true;
      }),
  };

  readonly vehicle = {
    findMany: async ({
      where,
    }: {
      where: {
        driverId?: string | { not: string };
        OR?: Array<{
          vinHash?: { in: string[] };
          registrationNumberHash?: { in: string[] };
        }>;
      };
    }) =>
      this.vehicles.filter((vehicle) => {
        if (
          typeof where.driverId === 'string' &&
          vehicle.driverId !== where.driverId
        )
          return false;
        if (
          where.driverId &&
          typeof where.driverId === 'object' &&
          'not' in where.driverId &&
          vehicle.driverId === where.driverId.not
        )
          return false;
        if (where.OR) {
          return where.OR.some((clause) => {
            if (clause.vinHash && vehicle.vinHash) {
              return clause.vinHash.in.includes(vehicle.vinHash);
            }
            if (clause.registrationNumberHash) {
              return clause.registrationNumberHash.in.includes(
                vehicle.registrationNumberHash,
              );
            }
            return false;
          });
        }
        return true;
      }),
  };

  readonly deviceSession = {
    findMany: async ({
      where,
    }: {
      where: {
        userId?: string | { not: string };
        deviceId?: { in: string[] };
        user?: { role: string };
      };
    }) =>
      this.deviceSessions.filter((session) => {
        if (typeof where.userId === 'string' && session.userId !== where.userId)
          return false;
        if (
          where.userId &&
          typeof where.userId === 'object' &&
          'not' in where.userId &&
          session.userId === where.userId.not
        )
          return false;
        if (where.deviceId && !where.deviceId.in.includes(session.deviceId))
          return false;
        if (where.user && session.role !== where.user.role) return false;
        return true;
      }),
  };
}

describe('DriverDuplicateDetectionService', () => {
  let prisma: InMemoryPrisma;
  let service: DriverDuplicateDetectionService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    service = new DriverDuplicateDetectionService(
      prisma as unknown as PrismaService,
    );
  });

  it('returns NO_MATCH when nothing overlaps with any other driver', async () => {
    prisma.driverDocuments.push({
      driverId: DRIVER_ID,
      documentNumberHash: 'abc',
    });

    const result = await service.checkForDuplicates(DRIVER_ID);

    expect(result.result).toBe(DuplicateMatchResult.NO_MATCH);
    expect(result.matches).toHaveLength(0);
  });

  it('never returns STRONG_MATCH from a single signal category', async () => {
    prisma.driverDocuments.push(
      { driverId: DRIVER_ID, documentNumberHash: 'shared-passport' },
      { driverId: OTHER_DRIVER_ID, documentNumberHash: 'shared-passport' },
    );

    const result = await service.checkForDuplicates(DRIVER_ID);

    expect(result.result).toBe(DuplicateMatchResult.POSSIBLE_MATCH);
  });

  it('returns STRONG_MATCH when two signal categories point at the same other driver', async () => {
    prisma.driverDocuments.push(
      { driverId: DRIVER_ID, documentNumberHash: 'shared-passport' },
      { driverId: OTHER_DRIVER_ID, documentNumberHash: 'shared-passport' },
    );
    prisma.deviceSessions.push(
      { userId: DRIVER_ID, deviceId: 'device-x', role: 'DRIVER' },
      { userId: OTHER_DRIVER_ID, deviceId: 'device-x', role: 'DRIVER' },
    );

    const result = await service.checkForDuplicates(DRIVER_ID);

    expect(result.result).toBe(DuplicateMatchResult.STRONG_MATCH);
  });

  it('returns MANUAL_REVIEW_REQUIRED when signals point at more than one other driver', async () => {
    prisma.driverDocuments.push(
      { driverId: DRIVER_ID, documentNumberHash: 'shared-passport' },
      { driverId: OTHER_DRIVER_ID, documentNumberHash: 'shared-passport' },
    );
    prisma.deviceSessions.push(
      { userId: DRIVER_ID, deviceId: 'device-x', role: 'DRIVER' },
      { userId: 'driver-3', deviceId: 'device-x', role: 'DRIVER' },
    );

    const result = await service.checkForDuplicates(DRIVER_ID);

    expect(result.result).toBe(DuplicateMatchResult.MANUAL_REVIEW_REQUIRED);
  });

  it('ignores a shared device belonging to a non-driver account', async () => {
    prisma.deviceSessions.push(
      { userId: DRIVER_ID, deviceId: 'device-x', role: 'DRIVER' },
      { userId: 'passenger-1', deviceId: 'device-x', role: 'PASSENGER' },
    );

    const result = await service.checkForDuplicates(DRIVER_ID);

    expect(result.result).toBe(DuplicateMatchResult.NO_MATCH);
  });
});
