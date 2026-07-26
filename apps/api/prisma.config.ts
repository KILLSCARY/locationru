import { config as loadEnvironment } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnvironment({
  path: resolve(process.cwd(), '../../.env'),
  quiet: true,
});
loadEnvironment({
  path: resolve(process.cwd(), '.env'),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
