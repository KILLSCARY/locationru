import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.getOrThrow<string>('redis.url'), {
      commandTimeout: 2_000,
      connectTimeout: 2_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 1_000),
    });

    this.client.on('error', (error: Error) => {
      this.logger.warn({
        event: 'redis.connection_error',
        message: error.message,
      });
    });
  }

  async checkConnection(): Promise<void> {
    const response = await this.client.ping();

    if (response !== 'PONG') {
      throw new Error(`Unexpected Redis PING response: ${response}`);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);
  }

  /** No TTL — only for state that must survive until explicitly deleted (e.g. an admin's indefinite auth block). Prefer setWithTtl for anything that should self-expire. */
  async setPersistent(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  async setIfNotExistsWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async increment(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrementBy(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
  }

  async setExpiry(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async getTtl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end' || this.client.status === 'wait') {
      this.client.disconnect();
      return;
    }

    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
