import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service.js';
import { NotificationOutboxWorker } from '../notifications/notification-outbox.worker.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { RedisService } from '../redis/redis.service.js';
import { OBJECT_STORAGE_PROVIDER } from '../storage/object-storage-provider.interface.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  let healthService: HealthService;
  let prisma: { checkConnection: jest.Mock; checkMigrationsApplied: jest.Mock };
  let redis: { checkConnection: jest.Mock };
  let outbox: { isRunning: jest.Mock };
  let pushOutbox: { isRunning: jest.Mock };
  let objectStorage: { checkConnection: jest.Mock };

  beforeEach(async () => {
    prisma = {
      checkConnection: jest.fn().mockResolvedValue(undefined),
      checkMigrationsApplied: jest.fn().mockResolvedValue(true),
    };
    redis = { checkConnection: jest.fn().mockResolvedValue(undefined) };
    outbox = { isRunning: jest.fn().mockReturnValue(true) };
    pushOutbox = { isRunning: jest.fn().mockReturnValue(true) };
    objectStorage = { checkConnection: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'app.appEnvironment'
                ? 'test'
                : key === 'objectStorage.endpoint'
                  ? 'http://minio.local'
                  : undefined,
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: RealtimeOutboxService, useValue: outbox },
        { provide: NotificationOutboxWorker, useValue: pushOutbox },
        { provide: OBJECT_STORAGE_PROVIDER, useValue: objectStorage },
      ],
    }).compile();

    healthService = module.get(HealthService);
  });

  it('returns an ok liveness status', () => {
    expect(healthService.getHealth()).toEqual({ status: 'ok' });
    expect(healthService.getLiveness()).toEqual({ status: 'ok' });
  });

  it('returns an ok readiness status when dependencies are available', async () => {
    await expect(healthService.getReadiness()).resolves.toEqual({
      status: 'ok',
      checks: {
        postgres: 'up',
        redis: 'up',
        migrations: 'up',
        outboxWorker: 'up',
        pushOutboxWorker: 'up',
        objectStorage: 'up',
        config: 'up',
      },
    });
  });

  it('reports error when a migration has not finished cleanly', async () => {
    prisma.checkMigrationsApplied.mockResolvedValue(false);

    const readiness = await healthService.getReadiness();
    expect(readiness.status).toBe('error');
    expect(readiness.checks.migrations).toBe('down');
  });

  it('reports error when the outbox worker is not running', async () => {
    outbox.isRunning.mockReturnValue(false);

    const readiness = await healthService.getReadiness();
    expect(readiness.status).toBe('error');
    expect(readiness.checks.outboxWorker).toBe('down');
  });

  it('reports error when the push outbox worker is not running', async () => {
    pushOutbox.isRunning.mockReturnValue(false);

    const readiness = await healthService.getReadiness();
    expect(readiness.status).toBe('error');
    expect(readiness.checks.pushOutboxWorker).toBe('down');
  });

  it('includes per-check timing and error detail in the detailed status', async () => {
    redis.checkConnection.mockRejectedValue(new Error('ECONNREFUSED'));

    const detailed = await healthService.getDetailedStatus();
    expect(detailed.status).toBe('error');
    expect(detailed.checks.redis.status).toBe('down');
    expect(detailed.checks.redis.error).toBe('ECONNREFUSED');
    expect(typeof detailed.checks.redis.durationMs).toBe('number');
  });
});
