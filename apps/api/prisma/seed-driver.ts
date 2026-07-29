import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Development seed for a ready-to-use driver: a DRIVER user with an APPROVED
 * profile and an APPROVED vehicle, so the driver app can go online and bid.
 * Configure with SEED_DRIVER_PHONE / SEED_DRIVER_PLATE.
 */
async function seed(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    console.log('Driver seed skipped: NODE_ENV is not development');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  const phone = process.env.SEED_DRIVER_PHONE ?? '+79991112233';
  const registrationNumber = process.env.SEED_DRIVER_PLATE ?? 'А123ВС77';

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  if (!E164_PHONE_PATTERN.test(phone)) {
    throw new Error(
      'SEED_DRIVER_PHONE must be a normalized E.164 phone number',
    );
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const user = await prisma.user.upsert({
      where: { phone },
      update: { role: 'DRIVER', status: 'ACTIVE' },
      create: { phone, role: 'DRIVER', status: 'ACTIVE' },
    });

    await prisma.driverProfile.upsert({
      where: { userId: user.id },
      update: { status: 'OFFLINE', verificationStatus: 'APPROVED' },
      create: {
        userId: user.id,
        firstName: 'Тест',
        lastName: 'Водитель',
        status: 'OFFLINE',
        verificationStatus: 'APPROVED',
      },
    });

    const vehicle = await prisma.vehicle.upsert({
      where: { registrationNumber },
      update: { driverId: user.id, status: 'APPROVED' },
      create: {
        driverId: user.id,
        brand: 'Kia',
        model: 'Rio',
        color: 'белый',
        registrationNumber,
        productionYear: 2021,
        status: 'APPROVED',
      },
    });

    console.log(
      JSON.stringify({
        event: 'seed.driver_ready',
        phone,
        driverId: user.id,
        vehicleId: vehicle.id,
        registrationNumber,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
