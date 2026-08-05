import type { RedisService } from '../../src/redis/redis.service.js';

interface Entry {
  value: string;
  expiresAt: number | null;
}

/**
 * Minimal in-memory stand-in for {@link RedisService}'s public surface, used by
 * integration tests that exercise caching/rate-limiting without a real Redis.
 */
export class InMemoryRedisService {
  private readonly store = new Map<string, Entry>();

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  async setIfNotExistsWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const existing = this.store.get(key);
    if (existing && !this.isExpired(existing)) {
      return false;
    }
    await this.setWithTtl(key, value, ttlSeconds);
    return true;
  }

  async increment(key: string): Promise<number> {
    const current = Number((await this.get(key)) ?? '0') + 1;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(current),
      expiresAt:
        existing && !this.isExpired(existing) ? existing.expiresAt : null,
    });
    return current;
  }

  async incrementBy(key: string, amount: number): Promise<number> {
    const current = Number((await this.get(key)) ?? '0') + amount;
    await this.setWithTtl(key, String(current), 60);
    return current;
  }

  async setExpiry(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1_000;
    }
  }

  async getTtl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt === null) {
      return -1;
    }
    return Math.ceil((entry.expiresAt - Date.now()) / 1_000);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export function asRedisService(fake: InMemoryRedisService): RedisService {
  return fake as unknown as RedisService;
}
