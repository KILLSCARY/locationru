import { MapsCacheService } from './maps-cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { z } from 'zod';

class MemoryRedis {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setWithTtl(key: string, value: string) {
    this.values.set(key, value);
  }
  async setIfNotExistsWithTtl(key: string, value: string) {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async deleteIfValue(key: string, expectedValue: string) {
    if (this.values.get(key) !== expectedValue) return false;
    this.values.delete(key);
    return true;
  }
}

describe('MapsCacheService', () => {
  it('serves cache hits and deduplicates simultaneous misses', async () => {
    const redis = new MemoryRedis();
    const cache = new MapsCacheService(redis as unknown as RedisService);
    let loads = 0;
    const loader = async () => {
      loads += 1;
      await Promise.resolve();
      return { value: 'route' };
    };
    const schema = z.object({ value: z.string() });
    const [first, second] = await Promise.all([
      cache.getOrLoad('maps:test', 60, schema, loader),
      cache.getOrLoad('maps:test', 60, schema, loader),
    ]);
    expect(first).toEqual({ value: 'route' });
    expect(second).toEqual(first);
    expect(loads).toBe(1);
    await expect(
      cache.getOrLoad('maps:test', 60, schema, loader),
    ).resolves.toEqual(first);
    expect(loads).toBe(1);
  });

  it('drops invalid cached provider data instead of returning it', async () => {
    const redis = new MemoryRedis();
    redis.values.set('maps:test', JSON.stringify({ value: 42 }));
    const cache = new MapsCacheService(redis as unknown as RedisService);
    await expect(
      cache.getOrLoad(
        'maps:test',
        60,
        z.object({ value: z.string() }),
        async () => ({ value: 'valid' }),
      ),
    ).resolves.toEqual({ value: 'valid' });
  });
});
