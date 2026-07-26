import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

interface PageQuery {
  page?: string;
  pageSize?: string;
}

export interface LocationRow {
  id: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedMetersPerSecond: number | null;
  bearingDegrees: number | null;
  suspectedSpoofing: boolean;
  stale: boolean;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    query: PageQuery & { role?: string; status?: string; search?: string },
  ) {
    const pagination = this.pagination(query);
    const where = {
      ...(query.role ? { role: query.role as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search ? { phone: { contains: query.search } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        select: {
          id: true,
          phone: true,
          role: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return this.page(items, total, pagination);
  }

  async listDrivers(
    query: PageQuery & { verificationStatus?: string; status?: string },
  ) {
    const pagination = this.pagination(query);
    const where = {
      ...(query.verificationStatus
        ? { verificationStatus: query.verificationStatus as never }
        : {}),
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.driverProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          user: { select: { id: true, phone: true, status: true } },
          vehicles: {
            select: {
              id: true,
              brand: true,
              model: true,
              registrationNumber: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.driverProfile.count({ where }),
    ]);

    return this.page(items, total, pagination);
  }

  async listTrips(query: PageQuery & { status?: string }) {
    const pagination = this.pagination(query);
    const where = query.status ? { status: query.status as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          passenger: { select: { id: true, phone: true } },
          selectedDriver: { select: { id: true, phone: true } },
        },
      }),
      this.prisma.trip.count({ where }),
    ]);

    return this.page(items, total, pagination);
  }

  async getTripDetails(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        bids: {
          orderBy: { createdAt: 'desc' },
          include: {
            driver: { include: { user: { select: { phone: true } } } },
            vehicle: {
              select: { brand: true, model: true, registrationNumber: true },
            },
          },
        },
      },
    });

    if (!trip) {
      throw new NotFoundException({
        code: 'TRIP_NOT_FOUND',
        message: 'Trip was not found',
      });
    }

    const locations = trip.selectedDriverId
      ? await this.prisma.$queryRaw<LocationRow[]>`
          SELECT "id", "recordedAt", ST_Y("location"::geometry) AS "latitude",
                 ST_X("location"::geometry) AS "longitude", "accuracyMeters",
                 "speedMetersPerSecond", "bearingDegrees", "suspectedSpoofing", "stale"
          FROM "driver_locations"
          WHERE "driverId" = ${trip.selectedDriverId}
          ORDER BY "recordedAt" DESC
          LIMIT 100
        `
      : [];

    return { trip, locations };
  }

  async listPayments(query: PageQuery & { status?: string }) {
    const pagination = this.pagination(query);
    const where = query.status ? { status: query.status as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.paymentIntent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          trip: { select: { id: true, status: true } },
          transactions: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.paymentIntent.count({ where }),
    ]);

    return this.page(items, total, pagination);
  }

  async reviewDriver(
    adminId: string,
    driverId: string,
    decision: 'APPROVED' | 'REJECTED',
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const driver = await transaction.driverProfile.update({
        where: { userId: driverId },
        data: { verificationStatus: decision },
        include: { user: { select: { phone: true } } },
      });
      await transaction.adminAuditLog.create({
        data: {
          adminId,
          action: `DRIVER_${decision}`,
          targetType: 'DRIVER',
          targetId: driverId,
          payload: { decision },
        },
      });
      return driver;
    });
  }

  async reviewVehicle(
    adminId: string,
    vehicleId: string,
    decision: 'APPROVED' | 'REJECTED',
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const vehicle = await transaction.vehicle.update({
        where: { id: vehicleId },
        data: { status: decision },
      });
      await transaction.adminAuditLog.create({
        data: {
          adminId,
          action: `VEHICLE_${decision}`,
          targetType: 'VEHICLE',
          targetId: vehicleId,
          payload: { decision },
        },
      });
      return vehicle;
    });
  }

  async blockUser(adminId: string, userId: string) {
    if (adminId === userId) {
      throw new ConflictException({
        code: 'ADMIN_CANNOT_BLOCK_SELF',
        message: 'An administrator cannot block their own account',
      });
    }

    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: userId },
        data: { status: 'BLOCKED' },
        select: { id: true, phone: true, role: true, status: true },
      });
      await transaction.adminAuditLog.create({
        data: {
          adminId,
          action: 'USER_BLOCKED',
          targetType: 'USER',
          targetId: userId,
          payload: {},
        },
      });
      return user;
    });
  }

  async listAudit(query: PageQuery) {
    const pagination = this.pagination(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: { admin: { select: { phone: true } } },
      }),
      this.prisma.adminAuditLog.count(),
    ]);
    return this.page(items, total, pagination);
  }

  private pagination(query: PageQuery) {
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20),
    );
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private page<T>(
    items: T[],
    total: number,
    pagination: { page: number; pageSize: number },
  ) {
    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }
}
