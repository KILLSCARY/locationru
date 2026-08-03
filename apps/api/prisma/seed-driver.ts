import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';

import { DriverDataCryptoService } from '../src/drivers/infrastructure/driver-data-crypto.service.js';
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

  const crypto = new DriverDataCryptoService(
    new ConfigService({
      driverVerification: {
        dataEncryptionKey: process.env.DRIVER_DATA_ENCRYPTION_KEY,
        dataHashSecret: process.env.DRIVER_DATA_HASH_SECRET,
      },
    }),
  );
  const registrationNumberHash = crypto.hash(registrationNumber);

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
      update: { operationalStatus: 'OFFLINE', verificationStatus: 'APPROVED' },
      create: {
        userId: user.id,
        firstName: 'Тест',
        lastName: 'Водитель',
        phone,
        cityId: 'moscow',
        birthDate: new Date('1990-01-01'),
        operationalStatus: 'OFFLINE',
        verificationStatus: 'APPROVED',
        approvedAt: new Date(),
      },
    });

    const vehicle = await prisma.vehicle.upsert({
      where: { registrationNumberHash },
      update: {
        driverId: user.id,
        status: 'ACTIVE',
        verificationStatus: 'APPROVED',
      },
      create: {
        driverId: user.id,
        brand: 'Kia',
        model: 'Rio',
        color: 'белый',
        registrationNumberEncrypted: crypto.encrypt(registrationNumber),
        registrationNumberMasked: `••${registrationNumber.slice(-4)}`,
        registrationNumberHash,
        productionYear: 2021,
        category: 'ECONOMY',
        seats: 4,
        status: 'ACTIVE',
        verificationStatus: 'APPROVED',
        approvedAt: new Date(),
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
