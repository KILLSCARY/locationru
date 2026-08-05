import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class MapsCacheService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    schema: z.ZodType<T>,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.read(key, schema);
    if (cached !== undefined) return cached;

    const current = this.inFlight.get(key) as Promise<T> | undefined;
    if (current) return current;

    const pending = this.loadWithDistributedLock(
      key,
      ttlSeconds,
      schema,
      loader,
    );
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async loadWithDistributedLock<T>(
    key: string,
    ttlSeconds: number,
    schema: z.ZodType<T>,
    loader: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    const acquired = await this.redis.setIfNotExistsWithTtl(lockKey, token, 5);
    if (!acquired) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        const cached = await this.read(key, schema);
        if (cached !== undefined) return cached;
      }
    }

    try {
      const loaded = schema.parse(await loader());
      await this.redis.setWithTtl(key, JSON.stringify(loaded), ttlSeconds);
      return loaded;
    } finally {
      if (acquired) await this.redis.deleteIfValue(lockKey, token);
    }
  }

  private async read<T>(
    key: string,
    schema: z.ZodType<T>,
  ): Promise<T | undefined> {
    const raw = await this.redis.get(key);
    if (!raw) return undefined;
    try {
      return schema.parse(JSON.parse(raw));
    } catch {
      await this.redis.delete(key);
      return undefined;
    }
  }
}
