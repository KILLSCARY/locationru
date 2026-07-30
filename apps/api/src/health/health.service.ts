import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { RedisService } from '../redis/redis.service.js';
import { OBJECT_STORAGE_PROVIDER } from '../storage/object-storage-provider.interface.js';
import type { ObjectStorageProvider } from '../storage/object-storage-provider.interface.js';

export interface HealthResponse {
  status: 'ok';
}

export type DependencyStatus = 'up' | 'down';

export interface ReadinessResponse {
  status: 'ok' | 'error';
  checks: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    migrations: DependencyStatus;
    outboxWorker: DependencyStatus;
    objectStorage: DependencyStatus;
    config: DependencyStatus;
  };
}

export interface DependencyDetail {
  status: DependencyStatus;
  durationMs: number;
  error?: string;
}

export interface DetailedStatusResponse {
  status: 'ok' | 'error';
  checks: Record<keyof ReadinessResponse['checks'], DependencyDetail>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly outbox: RealtimeOutboxService,
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly objectStorage: ObjectStorageProvider,
  ) {}

  getHealth(): HealthResponse {
    return { status: 'ok' };
  }

  /** Confirms only that the process itself is alive — no dependency I/O. */
  getLiveness(): HealthResponse {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const detailed = await this.getDetailedStatus();
    const checks = Object.fromEntries(
      Object.entries(detailed.checks).map(([name, detail]) => [
        name,
        detail.status,
      ]),
    ) as ReadinessResponse['checks'];

    return { status: detailed.status, checks };
  }

  /**
   * Full detail (per-check timing + error message) for the admin-only
   * dependency-status endpoint. The public readiness endpoint intentionally
   * strips this down to bare up/down so it never leaks infrastructure
   * topology or internal error text to an unauthenticated caller.
   *
   * None of these checks call the external map provider — that dependency
   * is exercised on-demand per request already and would add latency/cost
   * to every readiness probe for no operational benefit.
   */
  async getDetailedStatus(): Promise<DetailedStatusResponse> {
    const [postgres, redis, migrations, outboxWorker, objectStorage, config] =
      await Promise.all([
        this.timed(() => this.prisma.checkConnection()),
        this.timed(() => this.redis.checkConnection()),
        this.timed(async () => {
          const applied = await this.prisma.checkMigrationsApplied();
          if (!applied)
            throw new Error('One or more migrations did not finish cleanly');
        }),
        this.timed(async () => {
          if (!this.outbox.isRunning()) {
            throw new Error('Outbox poll worker is not running');
          }
        }),
        this.timed(() => this.checkObjectStorage()),
        this.timed(() => this.checkConfig()),
      ]);

    const checks = {
      postgres,
      redis,
      migrations,
      outboxWorker,
      objectStorage,
      config,
    };

    const status = Object.values(checks).every((check) => check.status === 'up')
      ? 'ok'
      : 'error';

    return { status, checks };
  }

  /**
   * Object storage is optional outside staging/production (local dev has
   * no need to exercise document uploads, and falls back to a Noop
   * provider that always throws). Only probe it for real once it's
   * actually configured — Joi already requires OBJECT_STORAGE_ENDPOINT to
   * be set once app.requiresHardenedConfig is true, so a deployed
   * environment always exercises the real check.
   */
  private async checkObjectStorage(): Promise<void> {
    const endpoint = this.configService.get<string>('objectStorage.endpoint');
    if (!endpoint) return;
    await this.objectStorage.checkConnection();
  }

  /**
   * Joi validation already fail-fast-rejects a bad config at process
   * startup (see EnvironmentValidationSchema), so by the time this runs the
   * config is known-valid — this just confirms the parsed config this
   * process booted with is still readable, catching the (currently
   * theoretical) case of a provider mutating it after boot.
   */
  private async checkConfig(): Promise<void> {
    const appEnvironment = this.configService.get<string>('app.appEnvironment');
    if (!appEnvironment) {
      throw new Error(
        'app.appEnvironment is missing from the loaded configuration',
      );
    }
  }

  private async timed(fn: () => Promise<void>): Promise<DependencyDetail> {
    const startedAt = process.hrtime.bigint();
    try {
      await fn();
      return { status: 'up', durationMs: this.elapsedMs(startedAt) };
    } catch (error) {
      return {
        status: 'down',
        durationMs: this.elapsedMs(startedAt),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private elapsedMs(startedAt: bigint): number {
    return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  }
}
