import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let healthService: HealthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            checkConnection: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RedisService,
          useValue: {
            checkConnection: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    healthService = module.get(HealthService);
  });

  it('returns an ok liveness status', () => {
    expect(healthService.getHealth()).toEqual({ status: 'ok' });
  });

  it('returns an ok readiness status when dependencies are available', async () => {
    await expect(healthService.getReadiness()).resolves.toEqual({
      status: 'ok',
      checks: {
        postgres: 'up',
        redis: 'up',
      },
    });
  });
});
