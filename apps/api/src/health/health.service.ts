import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export interface HealthResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ok' | 'error';
  checks: {
    postgres: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getHealth(): HealthResponse {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [postgres, redis] = await Promise.allSettled([
      this.prisma.checkConnection(),
      this.redis.checkConnection(),
    ]);

    const checks: ReadinessResponse['checks'] = {
      postgres: postgres.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
    };

    return {
      status:
        checks.postgres === 'up' && checks.redis === 'up' ? 'ok' : 'error',
      checks,
    };
  }
}
