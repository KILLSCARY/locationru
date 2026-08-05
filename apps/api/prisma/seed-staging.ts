import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';

import { DriverDataCryptoService } from '../src/drivers/infrastructure/driver-data-crypto.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  STAGING_SUPER_ADMIN_PHONE,
  STAGING_TEST_DRIVER_PHONE,
  STAGING_TEST_PASSENGER_PHONE,
  STAGING_TEST_VEHICLE_REGISTRATION_NUMBER,
} from '../src/staging-tools/staging-test-accounts.js';

const STAGING_CITY_CODE = 'MOW';
const STAGING_CITY_COMMISSION_BASIS_POINTS = 800;

/**
 * Idempotent staging fixture data: one SUPER_ADMIN, one passenger, one
 * verified driver + vehicle, one city commission rate. Safe to re-run —
 * every write is an upsert keyed on a fixed phone number or natural key,
 * never a fresh insert. No passwords exist in this system (auth is
 * OTP-only), no OTP is generated or printed here, and nothing here creates
 * a session or token, so there is nothing sensitive for this script to
 * leak.
 */
async function seedStaging(): Promise<void> {
  const appEnvironment = process.env.APP_ENV ?? process.env.NODE_ENV;
  if (appEnvironment === 'production') {
    throw new Error('Refusing to run the staging seed with APP_ENV=production');
  }
  if (appEnvironment !== 'staging') {
    console.warn(
      `Warning: APP_ENV is "${appEnvironment ?? 'unset'}", not "staging" — proceeding anyway, ` +
        'but this seed is intended for the staging environment.',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  const crypto = new DriverDataCryptoService(
    new ConfigService({
      driverVerification: {
        dataEncryptionKey: process.env.DRIVER_DATA_ENCRYPTION_KEY,
        dataHashSecret: process.env.DRIVER_DATA_HASH_SECRET,
      },
    }),
  );
  const registrationNumberHash = crypto.hash(
    STAGING_TEST_VEHICLE_REGISTRATION_NUMBER,
  );

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const superAdmin = await prisma.user.upsert({
      where: { phone: STAGING_SUPER_ADMIN_PHONE },
      update: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      create: {
        phone: STAGING_SUPER_ADMIN_PHONE,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log(`SUPER_ADMIN ready: ${superAdmin.phone}`);

    const passenger = await prisma.user.upsert({
      where: { phone: STAGING_TEST_PASSENGER_PHONE },
      update: { role: 'PASSENGER', status: 'ACTIVE' },
      create: {
        phone: STAGING_TEST_PASSENGER_PHONE,
        role: 'PASSENGER',
        status: 'ACTIVE',
      },
    });
    await prisma.passengerProfile.upsert({
      where: { userId: passenger.id },
      update: {},
      create: {
        userId: passenger.id,
        firstName: 'Staging',
        lastName: 'Passenger',
      },
    });
    console.log(`Test passenger ready: ${passenger.phone}`);

    const driver = await prisma.user.upsert({
      where: { phone: STAGING_TEST_DRIVER_PHONE },
      update: { role: 'DRIVER', status: 'ACTIVE' },
      create: {
        phone: STAGING_TEST_DRIVER_PHONE,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });
    await prisma.driverProfile.upsert({
      where: { userId: driver.id },
      update: {
        operationalStatus: 'OFFLINE',
        verificationStatus: 'APPROVED',
      },
      create: {
        userId: driver.id,
        firstName: 'Staging',
        lastName: 'Driver',
        phone: driver.phone,
        cityId: STAGING_CITY_CODE,
        birthDate: new Date('1990-01-01'),
        operationalStatus: 'OFFLINE',
        verificationStatus: 'APPROVED',
        approvedAt: new Date(),
      },
    });
    await prisma.vehicle.upsert({
      where: { registrationNumberHash },
      update: { status: 'ACTIVE', verificationStatus: 'APPROVED' },
      create: {
        driverId: driver.id,
        brand: 'Lada',
        model: 'Vesta',
        color: 'white',
        registrationNumberEncrypted: crypto.encrypt(
          STAGING_TEST_VEHICLE_REGISTRATION_NUMBER,
        ),
        registrationNumberMasked: `••${STAGING_TEST_VEHICLE_REGISTRATION_NUMBER.slice(-4)}`,
        registrationNumberHash,
        productionYear: 2022,
        category: 'ECONOMY',
        seats: 4,
        status: 'ACTIVE',
        verificationStatus: 'APPROVED',
        approvedAt: new Date(),
      },
    });
    console.log(`Verified test driver + vehicle ready: ${driver.phone}`);

    await prisma.cityCommissionRate.upsert({
      where: { cityCode: STAGING_CITY_CODE },
      update: { commissionBasisPoints: STAGING_CITY_COMMISSION_BASIS_POINTS },
      create: {
        cityCode: STAGING_CITY_CODE,
        commissionBasisPoints: STAGING_CITY_COMMISSION_BASIS_POINTS,
      },
    });
    console.log(`City commission rate ready: ${STAGING_CITY_CODE}`);

    console.log('Staging seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

seedStaging().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
