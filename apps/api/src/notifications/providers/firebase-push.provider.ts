import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { App } from 'firebase-admin/app';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import {
  getMessaging,
  type Message,
  type Messaging,
  type MulticastMessage,
} from 'firebase-admin/messaging';

import { CircuitBreaker } from '../../maps/providers/circuit-breaker.js';
import {
  type NotificationCategory,
  PushProviderType,
} from '../../generated/prisma/enums.js';
import type {
  PushHealthCheckResult,
  PushProvider,
  SendResult,
  SendToDeviceInput,
  SendToDevicesInput,
  SendToDevicesResult,
} from '../domain/push-provider.interface.js';
import { PushProviderError } from './push-provider.errors.js';

const FCM_MAX_TOKENS_PER_CALL = 500;

/** Must stay in sync with the channel ids the driver-android/passenger-mobile clients register — see docs/notifications/architecture.md. */
const ANDROID_CHANNEL_BY_CATEGORY: Record<NotificationCategory, string> = {
  TRIP_OFFERS: 'trip_offers',
  ACTIVE_TRIP: 'active_trip',
  PAYMENTS: 'payments',
  DRIVER_OPERATIONS: 'driver_operations',
  ACCOUNT: 'account',
  SECURITY: 'security',
};

/** FCM error codes that mean the token itself will never work again. */
const PERMANENT_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

/**
 * The only place `firebase-admin` is imported. Handles both Android (FCM
 * native) and iOS (FCM → APNs passthrough — see docs/notifications/apns.md
 * for why iOS doesn't get its own direct-APNs adapter). Credentials come
 * from FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY
 * (never a committed service-account JSON file) and the SDK app is
 * initialized lazily on first use, not in the constructor — so this class
 * can always be constructed by Nest DI even in environments where no
 * Firebase credentials are configured (dev/staging default to
 * Development/StagingPushProvider instead; see push-provider.resolver.ts).
 */
@Injectable()
export class FirebasePushProvider implements PushProvider, OnModuleDestroy {
  readonly name = PushProviderType.FCM;

  private readonly logger = new Logger(FirebasePushProvider.name);
  private readonly circuit: CircuitBreaker;
  private readonly messagingOverride?: Messaging;
  private app?: App;

  constructor(
    private readonly config: ConfigService,
    /** Test-only seam — production code always leaves this undefined and gets a lazily-initialized real client via getApp(). */
    @Optional() overrides?: { messaging?: Messaging },
  ) {
    this.circuit = new CircuitBreaker({
      failureThreshold: 5,
      openMs: 30_000,
    });
    if (overrides?.messaging) this.messagingOverride = overrides.messaging;
  }

  async sendToDevice(input: SendToDeviceInput): Promise<SendResult> {
    const message: Message = {
      token: input.rawToken,
      notification: { title: input.title, body: input.body },
      data: input.data,
      ...this.platformConfig(input),
    };

    try {
      const providerMessageId = await this.execute(() =>
        this.messaging().send(message),
      );
      return { status: 'ACCEPTED', providerMessageId };
    } catch (error) {
      return this.toSendResult(error);
    }
  }

  async sendToDevices(input: SendToDevicesInput): Promise<SendToDevicesResult> {
    const results: SendToDevicesResult['results'] = [];

    for (const chunk of this.chunk(input.targets, FCM_MAX_TOKENS_PER_CALL)) {
      const message: MulticastMessage = {
        tokens: chunk.map((target) => target.rawToken),
        notification: { title: input.title, body: input.body },
        data: input.data,
        ...this.platformConfig(input),
      };

      try {
        const response = await this.execute(() =>
          this.messaging().sendEachForMulticast(message),
        );
        response.responses.forEach((entry, index) => {
          const devicePushTokenId = chunk[index]!.devicePushTokenId;
          if (entry.success) {
            results.push({
              devicePushTokenId,
              status: 'ACCEPTED',
              ...(entry.messageId
                ? { providerMessageId: entry.messageId }
                : {}),
            });
          } else {
            const code = entry.error?.code;
            results.push({
              devicePushTokenId,
              ...this.classifyErrorCode(code),
            });
          }
        });
      } catch (error) {
        // The whole batch call failed (network/auth/circuit) — every target
        // in this chunk gets the same normalized outcome.
        const outcome = this.toSendResult(error);
        for (const target of chunk) {
          results.push({
            devicePushTokenId: target.devicePushTokenId,
            ...outcome,
          });
        }
      }
    }

    return { results };
  }

  validateToken(rawToken: string): boolean {
    return (
      rawToken.length >= 32 && rawToken.length <= 4_096 && !/\s/.test(rawToken)
    );
  }

  /** FCM has no server-side "unregister" call — invalidation is tracked in our own DevicePushToken.status, driven by TOKEN_INVALID delivery outcomes. */
  async disableToken(): Promise<void> {
    await Promise.resolve();
  }

  async healthCheck(): Promise<PushHealthCheckResult> {
    try {
      if (!this.messagingOverride) this.getApp();
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app);
    }
  }

  private messaging(): Messaging {
    return this.messagingOverride ?? getMessaging(this.getApp());
  }

  private getApp(): App {
    if (this.app) return this.app;

    const projectId = this.config.getOrThrow<string>('push.fcm.projectId');
    const clientEmail = this.config.getOrThrow<string>('push.fcm.clientEmail');
    // Env files store literal `\n` in the PEM — real newlines are restored here.
    const privateKey = this.config
      .getOrThrow<string>('push.fcm.privateKey')
      .replace(/\\n/g, '\n');

    this.app = initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }) },
      `push-fcm-${projectId}`,
    );
    return this.app;
  }

  private platformConfig(input: {
    priority: 'NORMAL' | 'HIGH';
    ttlSeconds: number;
    collapseKey?: string;
    category: NotificationCategory;
  }): Pick<Message, 'android' | 'apns'> {
    const androidPriority = input.priority === 'HIGH' ? 'high' : 'normal';
    const apnsPriority = input.priority === 'HIGH' ? '10' : '5';
    const expirationEpochSeconds =
      Math.floor(Date.now() / 1_000) + input.ttlSeconds;

    return {
      android: {
        priority: androidPriority,
        ttl: input.ttlSeconds * 1_000,
        ...(input.collapseKey ? { collapseKey: input.collapseKey } : {}),
        notification: {
          channelId: ANDROID_CHANNEL_BY_CATEGORY[input.category],
        },
      },
      apns: {
        headers: {
          'apns-priority': apnsPriority,
          'apns-expiration': String(expirationEpochSeconds),
          'apns-push-type': 'alert',
          ...(input.collapseKey
            ? { 'apns-collapse-id': input.collapseKey.slice(0, 64) }
            : {}),
        },
      },
    };
  }

  private classifyErrorCode(code: string | undefined): SendResult {
    if (code && PERMANENT_TOKEN_ERROR_CODES.has(code)) {
      return { status: 'TOKEN_INVALID', ...(code ? { errorCode: code } : {}) };
    }
    return { status: 'FAILED_TEMPORARY', ...(code ? { errorCode: code } : {}) };
  }

  private toSendResult(error: unknown): SendResult {
    const normalized = this.normalize(error);
    if (normalized.kind === 'invalid_token') {
      return { status: 'TOKEN_INVALID', errorCode: normalized.kind };
    }
    return {
      status: normalized.retryable ? 'FAILED_TEMPORARY' : 'FAILED_PERMANENT',
      errorCode: normalized.kind,
    };
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.circuit.canRequest()) {
      throw PushProviderError.circuitOpen('firebase');
    }
    try {
      const result = await fn();
      this.circuit.recordSuccess();
      return result;
    } catch (error) {
      const normalized = this.normalize(error);
      if (normalized.retryable) this.circuit.recordFailure();
      throw normalized;
    }
  }

  private normalize(error: unknown): PushProviderError {
    if (error instanceof PushProviderError) return error;
    const code = this.firebaseErrorCode(error);
    if (code && PERMANENT_TOKEN_ERROR_CODES.has(code)) {
      return PushProviderError.invalidToken('firebase');
    }
    if (
      code === 'messaging/quota-exceeded' ||
      code === 'messaging/server-unavailable'
    ) {
      return PushProviderError.rateLimited('firebase');
    }
    // Never log the raw error message here — a firebase-admin error can
    // include the offending token. Log only the classified code.
    this.logger.warn({
      event: 'push.firebase_request_failed',
      code: code ?? 'unknown',
    });
    return PushProviderError.unavailable('firebase', code ?? 'unknown');
  }

  private firebaseErrorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
