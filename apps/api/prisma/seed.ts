import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

async function seed(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    console.log('Seed skipped: NODE_ENV is not development');
    return;
  }

  const connectionString = requiredEnvironment('DATABASE_URL');
  const adminPhone = requiredPhone('SEED_ADMIN_PHONE');
  const passengerPhone = requiredPhone('SEED_PASSENGER_PHONE');
  const driverPhone = requiredPhone('SEED_DRIVER_PHONE');
  const registrationNumber = requiredEnvironment(
    'SEED_DRIVER_VEHICLE_REGISTRATION',
  );

  if (registrationNumber.length > 32) {
    throw new Error(
      'SEED_DRIVER_VEHICLE_REGISTRATION must contain at most 32 characters',
    );
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.user.upsert({
      where: { phone: adminPhone },
      update: { role: 'ADMIN', status: 'ACTIVE' },
      create: { phone: adminPhone, role: 'ADMIN', status: 'ACTIVE' },
    });

    const passenger = await prisma.user.upsert({
      where: { phone: passengerPhone },
      update: { role: 'PASSENGER', status: 'ACTIVE' },
      create: {
        phone: passengerPhone,
        role: 'PASSENGER',
        status: 'ACTIVE',
      },
    });
    await prisma.passengerProfile.upsert({
      where: { userId: passenger.id },
      update: { firstName: 'Dev', lastName: 'Passenger' },
      create: {
        userId: passenger.id,
        firstName: 'Dev',
        lastName: 'Passenger',
      },
    });

    const driver = await prisma.user.upsert({
      where: { phone: driverPhone },
      update: { role: 'DRIVER', status: 'ACTIVE' },
      create: { phone: driverPhone, role: 'DRIVER', status: 'ACTIVE' },
    });
    await prisma.driverProfile.upsert({
      where: { userId: driver.id },
      update: {
        firstName: 'Dev',
        lastName: 'Driver',
        status: 'OFFLINE',
        verificationStatus: 'APPROVED',
        commissionBasisPoints: null,
      },
      create: {
        userId: driver.id,
        firstName: 'Dev',
        lastName: 'Driver',
        status: 'OFFLINE',
        verificationStatus: 'APPROVED',
        commissionBasisPoints: null,
      },
    });
    await prisma.vehicle.upsert({
      where: { registrationNumber },
      update: {
        driverId: driver.id,
        brand: 'Resilient',
        model: 'Dev Car',
        color: 'White',
        productionYear: 2024,
        status: 'APPROVED',
      },
      create: {
        driverId: driver.id,
        brand: 'Resilient',
        model: 'Dev Car',
        color: 'White',
        registrationNumber,
        productionYear: 2024,
        status: 'APPROVED',
      },
    });

    console.log(
      JSON.stringify({
        event: 'development.seed.completed',
        accounts: {
          admin: adminPhone,
          passenger: passengerPhone,
          driver: driverPhone,
        },
        vehicleRegistrationNumber: registrationNumber,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to seed the database`);
  }

  return value;
}

function requiredPhone(name: string): string {
  const value = requiredEnvironment(name);

  if (!E164_PHONE_PATTERN.test(value)) {
    throw new Error(`${name} must be a normalized E.164 phone number`);
  }

  return value;
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
