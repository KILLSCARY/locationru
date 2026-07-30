import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('database.url');
    const adapter = new PrismaPg({ connectionString });

    super({ adapter });
  }

  async checkConnection(): Promise<void> {
    await this.$queryRawUnsafe('SELECT 1');
  }

  /**
   * Reports whether every applied migration finished cleanly. Doesn't
   * compare against the migrations/ directory on disk (that would require
   * filesystem access from a built image) — a failed or stuck migration
   * leaves `finished_at` null in Prisma's own tracking table, which is the
   * signal an operator actually needs at readiness time.
   */
  async checkMigrationsApplied(): Promise<boolean> {
    const rows = await this.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL',
    );
    return (rows[0]?.count ?? 0n) === 0n;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
