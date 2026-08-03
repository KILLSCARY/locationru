import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DriverDataCryptoService } from '../drivers/infrastructure/driver-data-crypto.service.js';
import {
  Prisma,
  VehicleStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';
import type { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto.js';

const P2002_UNIQUE_CONSTRAINT = 'P2002';

@Injectable()
export class VehicleService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: DriverDataCryptoService,
  ) {}

  async listVehicles(driverId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { driverId, status: { not: VehicleStatus.ARCHIVED } },
      orderBy: { createdAt: 'desc' },
    });
    return vehicles.map((vehicle) => this.toSummary(vehicle));
  }

  async getVehicle(driverId: string, vehicleId: string) {
    return this.toSummary(await this.requireOwnedVehicle(driverId, vehicleId));
  }

  async createVehicle(driverId: string, input: CreateVehicleDto) {
    await this.assertDriverProfileExists(driverId);

    const activeCount = await this.prisma.vehicle.count({
      where: { driverId, status: { not: VehicleStatus.ARCHIVED } },
    });
    const maxActiveVehicles = this.config.getOrThrow<number>(
      'driverVerification.maxActiveVehicles',
    );
    if (activeCount >= maxActiveVehicles) {
      throw new ConflictException({
        code: 'MAX_ACTIVE_VEHICLES_REACHED',
        message: `A driver may have at most ${maxActiveVehicles} vehicles`,
      });
    }

    const registrationNumberHash = this.crypto.hash(input.registrationNumber);
    await this.assertRegistrationNumberFree(registrationNumberHash);
    if (input.vin) {
      await this.assertVinFree(this.crypto.hash(input.vin));
    }

    try {
      const vehicle = await this.prisma.vehicle.create({
        data: {
          driverId,
          brand: input.brand,
          model: input.model,
          color: input.color,
          productionYear: input.productionYear,
          registrationNumberEncrypted: this.crypto.encrypt(
            input.registrationNumber,
          ),
          registrationNumberMasked: this.maskRegistrationNumber(
            input.registrationNumber,
          ),
          registrationNumberHash,
          vinEncrypted: input.vin ? this.crypto.encrypt(input.vin) : null,
          vinHash: input.vin ? this.crypto.hash(input.vin) : null,
          vinLastFour: input.vin ? input.vin.slice(-4) : null,
          category: input.category,
          seats: input.seats,
          childSeatAvailable: input.childSeatAvailable ?? false,
          luggageCapacity: input.luggageCapacity ?? null,
          petAllowed: input.petAllowed ?? false,
          status: VehicleStatus.INACTIVE,
          verificationStatus: VehicleVerificationStatus.DOCUMENTS_REQUIRED,
        },
      });
      return this.toSummary(vehicle);
    } catch (error) {
      throw this.mapUniqueConstraintError(error);
    }
  }

  async updateVehicle(
    driverId: string,
    vehicleId: string,
    input: UpdateVehicleDto,
  ) {
    const existing = await this.requireOwnedVehicle(driverId, vehicleId);

    const nextRegistrationNumber = input.registrationNumber;
    const nextVin = input.vin;
    if (nextRegistrationNumber) {
      const hash = this.crypto.hash(nextRegistrationNumber);
      if (hash !== existing.registrationNumberHash) {
        await this.assertRegistrationNumberFree(hash);
      }
    }
    if (nextVin) {
      const hash = this.crypto.hash(nextVin);
      if (hash !== existing.vinHash) {
        await this.assertVinFree(hash);
      }
    }

    const criticalFieldsChanged =
      (nextRegistrationNumber !== undefined &&
        this.crypto.hash(nextRegistrationNumber) !==
          existing.registrationNumberHash) ||
      (nextVin !== undefined &&
        this.crypto.hash(nextVin) !== (existing.vinHash ?? '')) ||
      (input.brand !== undefined && input.brand !== existing.brand) ||
      (input.model !== undefined && input.model !== existing.model) ||
      (input.productionYear !== undefined &&
        input.productionYear !== existing.productionYear);
    const shouldReturnToReview =
      criticalFieldsChanged &&
      existing.verificationStatus === VehicleVerificationStatus.APPROVED;

    try {
      const updated = await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: {
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.productionYear !== undefined
            ? { productionYear: input.productionYear }
            : {}),
          ...(nextRegistrationNumber !== undefined
            ? {
                registrationNumberEncrypted: this.crypto.encrypt(
                  nextRegistrationNumber,
                ),
                registrationNumberMasked: this.maskRegistrationNumber(
                  nextRegistrationNumber,
                ),
                registrationNumberHash: this.crypto.hash(
                  nextRegistrationNumber,
                ),
              }
            : {}),
          ...(nextVin !== undefined
            ? {
                vinEncrypted: this.crypto.encrypt(nextVin),
                vinHash: this.crypto.hash(nextVin),
                vinLastFour: nextVin.slice(-4),
              }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.seats !== undefined ? { seats: input.seats } : {}),
          ...(input.childSeatAvailable !== undefined
            ? { childSeatAvailable: input.childSeatAvailable }
            : {}),
          ...(input.luggageCapacity !== undefined
            ? { luggageCapacity: input.luggageCapacity }
            : {}),
          ...(input.petAllowed !== undefined
            ? { petAllowed: input.petAllowed }
            : {}),
          ...(shouldReturnToReview
            ? {
                verificationStatus: VehicleVerificationStatus.UNDER_REVIEW,
                approvedAt: null,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      return this.toSummary(updated);
    } catch (error) {
      throw this.mapUniqueConstraintError(error);
    }
  }

  /** The driver's chosen "in use" vehicle(s) — only ACTIVE + APPROVED vehicles are eligible for ONLINE, see DriverEligibilityService. */
  async setActive(driverId: string, vehicleId: string) {
    const vehicle = await this.requireOwnedVehicle(driverId, vehicleId);
    if (vehicle.status === VehicleStatus.BLOCKED) {
      throw new ConflictException({
        code: 'VEHICLE_BLOCKED',
        message: 'A blocked vehicle cannot be activated',
      });
    }
    return this.toSummary(
      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { status: VehicleStatus.ACTIVE },
      }),
    );
  }

  async setInactive(driverId: string, vehicleId: string) {
    await this.requireOwnedVehicle(driverId, vehicleId);
    return this.toSummary(
      await this.prisma.vehicle.update({
        where: { id: vehicleId },
        data: { status: VehicleStatus.INACTIVE },
      }),
    );
  }

  /** Archiving is the only removal path — vehicles keep their document/history trail, see docs/drivers/vehicles.md. */
  async archiveVehicle(driverId: string, vehicleId: string): Promise<void> {
    await this.requireOwnedVehicle(driverId, vehicleId);
    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: VehicleStatus.ARCHIVED },
    });
  }

  private async assertDriverProfileExists(driverId: string): Promise<void> {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { userId: true },
    });
    if (!profile) {
      throw new BadRequestException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Fill in the driver profile before adding a vehicle',
      });
    }
  }

  private async assertRegistrationNumberFree(hash: string): Promise<void> {
    const existing = await this.prisma.vehicle.findUnique({
      where: { registrationNumberHash: hash },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'REGISTRATION_NUMBER_ALREADY_REGISTERED',
        message: 'This registration number is already registered',
      });
    }
  }

  private async assertVinFree(hash: string): Promise<void> {
    const existing = await this.prisma.vehicle.findUnique({
      where: { vinHash: hash },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'VIN_ALREADY_REGISTERED',
        message: 'This VIN is already registered',
      });
    }
  }

  private async requireOwnedVehicle(driverId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle || vehicle.status === VehicleStatus.ARCHIVED) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND',
        message: 'Vehicle was not found',
      });
    }
    if (vehicle.driverId !== driverId) {
      throw new ForbiddenException({
        code: 'VEHICLE_ACCESS_DENIED',
        message: 'You do not own this vehicle',
      });
    }
    return vehicle;
  }

  private maskRegistrationNumber(raw: string): string {
    const trimmed = raw.trim();
    return `••${trimmed.slice(-4)}`;
  }

  private mapUniqueConstraintError(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === P2002_UNIQUE_CONSTRAINT
    ) {
      return new ConflictException({
        code: 'VEHICLE_IDENTIFIER_CONFLICT',
        message: 'This registration number or VIN is already registered',
      });
    }
    return error;
  }

  private toSummary(vehicle: {
    id: string;
    brand: string;
    model: string;
    color: string;
    productionYear: number;
    registrationNumberMasked: string;
    vinLastFour: string | null;
    category: string;
    status: string;
    verificationStatus: string;
    seats: number;
    childSeatAvailable: boolean;
    luggageCapacity: number | null;
    petAllowed: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      color: vehicle.color,
      productionYear: vehicle.productionYear,
      registrationNumberMasked: vehicle.registrationNumberMasked,
      vinLastFour: vehicle.vinLastFour,
      category: vehicle.category,
      status: vehicle.status,
      verificationStatus: vehicle.verificationStatus,
      seats: vehicle.seats,
      childSeatAvailable: vehicle.childSeatAvailable,
      luggageCapacity: vehicle.luggageCapacity,
      petAllowed: vehicle.petAllowed,
      createdAt: vehicle.createdAt,
      updatedAt: vehicle.updatedAt,
    };
  }
}
