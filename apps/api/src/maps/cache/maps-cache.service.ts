import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../redis/redis.service.js';

const LOCK_TTL_SECONDS = 5;
const STAMPEDE_WAIT_MS = 120;
const STAMPEDE_MAX_WAITS = 5;

/**
 * Redis-backed cache for maps results with a best-effort anti-stampede lock.
 *
 * On a miss the first caller acquires a short lock and computes the value; other
 * concurrent callers briefly wait and re-read the cache instead of all hitting
 * the provider at once. Cache and Redis failures never fail the request — they
 * degrade to a direct provider call.
 */
@Injectable()
export class MapsCacheService {
  private readonly logger = new Logger(MapsCacheService.name);

  constructor(private readonly redis: RedisService) {}

  async getOrCompute<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>,
    /** Only cache results the caller considers valid (e.g. non-empty). */
    isCacheable: (value: T) => boolean = () => true,
  ): Promise<T> {
    const cached = await this.readJson<T>(key);
    if (cached !== null) {
      return cached;
    }

    const lockKey = `${key}:lock`;
    const locked = await this.tryLock(lockKey);

    if (!locked) {
      const waited = await this.waitForValue<T>(key);
      if (waited !== null) {
        return waited;
      }
      // Lock holder did not publish in time — fall through and compute.
    }

    try {
      const value = await compute();
      if (isCacheable(value)) {
        await this.writeJson(key, value, ttlSeconds);
      }
      return value;
    } finally {
      if (locked) {
        await this.release(lockKey);
      }
    }
  }

  private async waitForValue<T>(key: string): Promise<T | null> {
    for (let attempt = 0; attempt < STAMPEDE_MAX_WAITS; attempt += 1) {
      await this.sleep(STAMPEDE_WAIT_MS);
      const value = await this.readJson<T>(key);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  private async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.warn('cache_read_failed', key, error);
      return null;
    }
  }

  private async writeJson<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.setWithTtl(key, JSON.stringify(value), ttlSeconds);
    } catch (error) {
      this.warn('cache_write_failed', key, error);
    }
  }

  private async tryLock(lockKey: string): Promise<boolean> {
    try {
      return await this.redis.setIfNotExistsWithTtl(
        lockKey,
        '1',
        LOCK_TTL_SECONDS,
      );
    } catch (error) {
      this.warn('cache_lock_failed', lockKey, error);
      // If locking fails, act as if we hold it so the caller still computes.
      return true;
    }
  }

  private async release(lockKey: string): Promise<void> {
    try {
      await this.redis.delete(lockKey);
    } catch (error) {
      this.warn('cache_unlock_failed', lockKey, error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private warn(event: string, key: string, error: unknown): void {
    this.logger.warn({
      event: `maps.${event}`,
      key,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
