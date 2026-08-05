import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DriverDataCryptoService } from '../drivers/infrastructure/driver-data-crypto.service.js';
import {
  VehicleStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';
import type { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { VehicleService } from './vehicle.service.js';

const DRIVER_ID = '00000000-0000-4000-8000-000000000010';

class InMemoryPrisma {
  vehicles: Array<Record<string, unknown>> = [];
  hasDriverProfile = true;
  private nextId = 1;

  readonly driverProfile = {
    findUnique: async () =>
      this.hasDriverProfile ? { userId: DRIVER_ID } : null,
  };

  readonly vehicle = {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      this.vehicles.filter((vehicle) => this.matches(vehicle, where)),
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      this.vehicles.find((vehicle) => this.matches(vehicle, where)) ?? null,
    count: async ({ where }: { where: Record<string, unknown> }) =>
      this.vehicles.filter((vehicle) => this.matches(vehicle, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const vehicle = {
        id: `vehicle-${this.nextId++}`,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        approvedAt: null,
        rejectedAt: null,
        ...data,
      };
      this.vehicles.push(vehicle);
      return vehicle;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const vehicle = this.vehicles.find((entry) => entry.id === where.id);
      if (!vehicle) throw new Error('not found');
      const { version, ...rest } = data;
      if (version && typeof version === 'object' && 'increment' in version) {
        vehicle.version =
          Number(vehicle.version ?? 0) + Number(version.increment);
      }
      Object.assign(vehicle, rest);
      return vehicle;
    },
  };

  private matches(
    vehicle: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === 'object' && 'not' in condition) {
        return vehicle[key] !== (condition as { not: unknown }).not;
      }
      return vehicle[key] === condition;
    });
  }
}

describe('VehicleService', () => {
  let prisma: InMemoryPrisma;
  let service: VehicleService;

  function buildService(maxActiveVehicles = 3): VehicleService {
    return new VehicleService(
      new ConfigService({ driverVerification: { maxActiveVehicles } }),
      prisma as unknown as PrismaService,
      new DriverDataCryptoService(
        new ConfigService({
          driverVerification: {
            dataEncryptionKey: Buffer.alloc(32, 3).toString('base64'),
            dataHashSecret: 'test-hash-secret-that-is-at-least-32-characters',
          },
        }),
      ),
    );
  }

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    service = buildService();
  });

  it('requires a driver profile before adding a vehicle', async () => {
    prisma.hasDriverProfile = false;

    const error = await captureError(
      service.createVehicle(DRIVER_ID, vehicleInput()),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'DRIVER_PROFILE_REQUIRED',
    });
  });

  it('creates a vehicle with a masked registration number and no plaintext stored', async () => {
    const result = await service.createVehicle(
      DRIVER_ID,
      vehicleInput({ registrationNumber: 'А123БВ777' }),
    );

    expect(result.registrationNumberMasked).toBe('••В777');
    expect(result.status).toBe(VehicleStatus.INACTIVE);
    expect(result.verificationStatus).toBe(
      VehicleVerificationStatus.DOCUMENTS_REQUIRED,
    );
    expect(prisma.vehicles[0]?.registrationNumberEncrypted).toBeDefined();
    expect(prisma.vehicles[0]).not.toHaveProperty('registrationNumber');
  });

  it('rejects a duplicate registration number', async () => {
    await service.createVehicle(
      DRIVER_ID,
      vehicleInput({ registrationNumber: 'А123БВ777' }),
    );

    const error = await captureError(
      service.createVehicle(
        DRIVER_ID,
        vehicleInput({ registrationNumber: 'а123бв777' }),
      ),
    );

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'REGISTRATION_NUMBER_ALREADY_REGISTERED',
    });
  });

  it('enforces the maximum number of vehicles per driver', async () => {
    service = buildService(1);
    await service.createVehicle(
      DRIVER_ID,
      vehicleInput({ registrationNumber: 'А111АА777' }),
    );

    const error = await captureError(
      service.createVehicle(
        DRIVER_ID,
        vehicleInput({ registrationNumber: 'А222АА777' }),
      ),
    );

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'MAX_ACTIVE_VEHICLES_REACHED',
    });
  });

  it('sends an approved vehicle back for re-review when a critical field changes', async () => {
    const created = await service.createVehicle(
      DRIVER_ID,
      vehicleInput({ registrationNumber: 'А123БВ777' }),
    );
    const stored = prisma.vehicles.find((v) => v.id === created.id);
    if (stored) stored.verificationStatus = VehicleVerificationStatus.APPROVED;

    const updated = await service.updateVehicle(DRIVER_ID, created.id, {
      brand: 'Toyota',
    });

    expect(updated.verificationStatus).toBe(
      VehicleVerificationStatus.UNDER_REVIEW,
    );
  });

  it('does not disturb verification status for a non-critical field change', async () => {
    const created = await service.createVehicle(
      DRIVER_ID,
      vehicleInput({ registrationNumber: 'А123БВ777' }),
    );
    const stored = prisma.vehicles.find((v) => v.id === created.id);
    if (stored) stored.verificationStatus = VehicleVerificationStatus.APPROVED;

    const updated = await service.updateVehicle(DRIVER_ID, created.id, {
      color: 'red',
    });

    expect(updated.verificationStatus).toBe(VehicleVerificationStatus.APPROVED);
  });

  it('rejects access from a driver who does not own the vehicle', async () => {
    const created = await service.createVehicle(
      DRIVER_ID,
      vehicleInput({ registrationNumber: 'А123БВ777' }),
    );

    const error = await captureError(
      service.getVehicle('someone-else', created.id),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({
      code: 'VEHICLE_ACCESS_DENIED',
    });
  });
});

function vehicleInput(
  overrides: Partial<CreateVehicleDto> = {},
): CreateVehicleDto {
  return {
    brand: 'Kia',
    model: 'Rio',
    color: 'white',
    productionYear: 2020,
    registrationNumber: 'А000АА777',
    category: 'economy',
    seats: 4,
    ...overrides,
  };
}

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }

  throw new Error('Expected promise to reject');
}
