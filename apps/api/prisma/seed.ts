import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

async function seed(): Promise<void> {
  const appEnvironment =
    process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  if (appEnvironment !== 'development') {
    console.log(
      `Seed skipped: APP_ENV is "${appEnvironment}", not development`,
    );
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  const phone = process.env.SEED_ADMIN_PHONE;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed the database');
  }

  if (!phone || !E164_PHONE_PATTERN.test(phone)) {
    throw new Error('SEED_ADMIN_PHONE must be a normalized E.164 phone number');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.user.upsert({
      where: { phone },
      update: {
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      create: {
        phone,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    console.log('Development administrator seed completed');
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
