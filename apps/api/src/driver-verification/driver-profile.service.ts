import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DriverVerificationStatus } from '../generated/prisma/client.js';
import { normalizeName } from './name-normalization.util.js';
import type { UpdateDriverProfileDto } from './dto/update-driver-profile.dto.js';

/** Identity-relevant fields — changing one of these after APPROVED sends the profile back for re-review (Task 29 section 2). Rating/completedTripsCount/profilePhotoObjectKey are system-managed and excluded; profilePhotoObjectKey only ever changes via the PROFILE_PHOTO document approval flow. */
const CRITICAL_FIELDS = [
  'firstName',
  'lastName',
  'middleName',
  'birthDate',
  'cityId',
] as const;

const MAX_REASONABLE_AGE = 100;

@Injectable()
export class DriverProfileService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getMyProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      return {
        verificationStatus: DriverVerificationStatus.NOT_STARTED,
        profileComplete: false,
      };
    }
    return { ...profile, profileComplete: true };
  }

  /**
   * Creates the profile on first call, updates it thereafter. Always
   * re-derives `phone` from the authenticated session — the request body has
   * no phone field at all, so there is nothing for a client to override.
   */
  async upsertProfile(userId: string, input: UpdateDriverProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, role: true },
    });
    if (!user || user.role !== 'DRIVER') {
      throw new ForbiddenException({
        code: 'DRIVER_ROLE_REQUIRED',
        message: 'Driver role is required',
      });
    }

    const firstName = normalizeName(input.firstName, 'firstName');
    const lastName = normalizeName(input.lastName, 'lastName');
    const middleName = input.middleName
      ? normalizeName(input.middleName, 'middleName')
      : null;
    const birthDate = this.parseAndValidateBirthDate(input.birthDate);

    const existing = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });

    const nextValues = {
      firstName,
      lastName,
      middleName,
      birthDate,
      cityId: input.cityId,
    };
    const criticalFieldsChanged =
      existing &&
      CRITICAL_FIELDS.some(
        (field) =>
          this.serializeField(existing[field]) !==
          this.serializeField(nextValues[field]),
      );
    const shouldReturnToReview =
      criticalFieldsChanged &&
      existing?.verificationStatus === DriverVerificationStatus.APPROVED;

    const data = {
      ...nextValues,
      phone: user.phone,
      email: input.email ?? null,
      ...(shouldReturnToReview
        ? { verificationStatus: DriverVerificationStatus.UNDER_REVIEW }
        : {}),
    };

    if (existing) {
      return this.prisma.driverProfile.update({
        where: { userId },
        data: { ...data, version: { increment: 1 } },
      });
    }

    return this.prisma.driverProfile.create({
      data: {
        userId,
        ...data,
        verificationStatus: DriverVerificationStatus.PROFILE_INCOMPLETE,
      },
    });
  }

  private parseAndValidateBirthDate(raw: string): Date {
    const birthDate = new Date(raw);
    if (Number.isNaN(birthDate.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_BIRTH_DATE',
        message: 'birthDate is not a valid date',
      });
    }
    const now = new Date();
    if (birthDate.getTime() > now.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_BIRTH_DATE',
        message: 'birthDate cannot be in the future',
      });
    }

    const minimumAge = this.config.getOrThrow<number>(
      'driverVerification.minimumAge',
    );
    const age = this.calculateAge(birthDate, now);
    if (age < minimumAge) {
      throw new BadRequestException({
        code: 'DRIVER_UNDERAGE',
        message: `Driver must be at least ${minimumAge} years old`,
      });
    }
    if (age > MAX_REASONABLE_AGE) {
      throw new BadRequestException({
        code: 'INVALID_BIRTH_DATE',
        message: 'birthDate is not plausible',
      });
    }
    return birthDate;
  }

  private calculateAge(birthDate: Date, now: Date): number {
    let age = now.getFullYear() - birthDate.getFullYear();
    const hasHadBirthdayThisYear =
      now.getMonth() > birthDate.getMonth() ||
      (now.getMonth() === birthDate.getMonth() &&
        now.getDate() >= birthDate.getDate());
    if (!hasHadBirthdayThisYear) age -= 1;
    return age;
  }

  private serializeField(value: unknown): string {
    if (value instanceof Date) return value.getTime().toString();
    return String(value ?? '');
  }
}
