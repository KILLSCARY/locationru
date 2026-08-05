import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DriverVerificationStatus } from '../generated/prisma/client.js';
import { DriverProfileService } from './driver-profile.service.js';
import type { UpdateDriverProfileDto } from './dto/update-driver-profile.dto.js';

const USER_ID = 'user-1';

function daysAgoYears(years: number): string {
  const now = new Date();
  return new Date(
    now.getFullYear() - years,
    now.getMonth(),
    now.getDate(),
  ).toISOString();
}

class FakePrisma {
  userRow: { phone: string; role: string } | null = {
    phone: '+79990000000',
    role: 'DRIVER',
  };
  existingProfile: Record<string, unknown> | null = null;
  updateCalls: Record<string, unknown>[] = [];
  createCalls: Record<string, unknown>[] = [];

  user = {
    findUnique: async () => this.userRow,
  };

  driverProfile = {
    findUnique: async () => this.existingProfile,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      this.updateCalls.push(data);
      return { ...this.existingProfile, ...data };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.createCalls.push(data);
      return data;
    },
  };
}

function toPrismaLike(fake: FakePrisma): PrismaService {
  return fake as unknown as PrismaService;
}

function baseInput(
  overrides: Partial<UpdateDriverProfileDto> = {},
): UpdateDriverProfileDto {
  return {
    firstName: 'Иван',
    lastName: 'Иванов',
    birthDate: daysAgoYears(25),
    cityId: 'msk',
    ...overrides,
  } as UpdateDriverProfileDto;
}

describe('DriverProfileService', () => {
  let prisma: FakePrisma;
  let service: DriverProfileService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new DriverProfileService(
      new ConfigService({ driverVerification: { minimumAge: 18 } }),
      toPrismaLike(prisma),
    );
  });

  it('rejects a non-driver user', async () => {
    prisma.userRow = { phone: '+79990000000', role: 'PASSENGER' };

    await expect(
      service.upsertProfile(USER_ID, baseInput()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a new profile with PROFILE_INCOMPLETE status and the session phone, ignoring any client-supplied phone', async () => {
    prisma.existingProfile = null;

    await service.upsertProfile(USER_ID, baseInput());

    expect(prisma.createCalls).toHaveLength(1);
    expect(prisma.createCalls[0]).toMatchObject({
      userId: USER_ID,
      phone: '+79990000000',
      verificationStatus: DriverVerificationStatus.PROFILE_INCOMPLETE,
    });
  });

  it('rejects a birth date that makes the driver younger than the configured minimum age', async () => {
    await expect(
      service.upsertProfile(
        USER_ID,
        baseInput({ birthDate: daysAgoYears(17) }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DRIVER_UNDERAGE' }),
    });
  });

  it('accepts a birth date exactly at the minimum age boundary', async () => {
    await expect(
      service.upsertProfile(
        USER_ID,
        baseInput({ birthDate: daysAgoYears(18) }),
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a birth date in the future', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    await expect(
      service.upsertProfile(
        USER_ID,
        baseInput({ birthDate: future.toISOString() }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_BIRTH_DATE' }),
    });
  });

  it('rejects an unparseable birth date string', async () => {
    await expect(
      service.upsertProfile(USER_ID, baseInput({ birthDate: 'not-a-date' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an implausibly old birth date', async () => {
    await expect(
      service.upsertProfile(
        USER_ID,
        baseInput({ birthDate: daysAgoYears(120) }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_BIRTH_DATE' }),
    });
  });

  it('sends an APPROVED profile back to UNDER_REVIEW when a critical field (birthDate) changes', async () => {
    prisma.existingProfile = {
      firstName: 'Иван',
      lastName: 'Иванов',
      middleName: null,
      birthDate: new Date(daysAgoYears(25)),
      cityId: 'msk',
      verificationStatus: DriverVerificationStatus.APPROVED,
    };

    await service.upsertProfile(
      USER_ID,
      baseInput({ birthDate: daysAgoYears(26) }),
    );

    expect(prisma.updateCalls[0]).toMatchObject({
      verificationStatus: DriverVerificationStatus.UNDER_REVIEW,
    });
  });

  it('does not revert an APPROVED profile when no critical field actually changes', async () => {
    const birthDate = daysAgoYears(25);
    prisma.existingProfile = {
      firstName: 'Иван',
      lastName: 'Иванов',
      middleName: null,
      birthDate: new Date(birthDate),
      cityId: 'msk',
      verificationStatus: DriverVerificationStatus.APPROVED,
    };

    await service.upsertProfile(USER_ID, baseInput({ birthDate }));

    expect(prisma.updateCalls[0]).not.toHaveProperty('verificationStatus');
  });

  it('does not revert a profile that is not currently APPROVED, even if a critical field changes', async () => {
    prisma.existingProfile = {
      firstName: 'Иван',
      lastName: 'Иванов',
      middleName: null,
      birthDate: new Date(daysAgoYears(25)),
      cityId: 'msk',
      verificationStatus: DriverVerificationStatus.UNDER_REVIEW,
    };

    await service.upsertProfile(
      USER_ID,
      baseInput({ birthDate: daysAgoYears(30) }),
    );

    expect(prisma.updateCalls[0]).not.toHaveProperty('verificationStatus');
  });

  it('rejects a first name containing disallowed characters', async () => {
    await expect(
      service.upsertProfile(USER_ID, baseInput({ firstName: '<script>' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
