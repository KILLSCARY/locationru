import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import {
  PushEnvironment,
  type PushApplication,
  type PushPlatform,
  type PushProviderType,
} from '../generated/prisma/enums.js';
import { determinePushProviderType } from './providers/push-provider-selection.js';
import { DevicePushTokenRepository } from './repositories/device-push-token.repository.js';

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 4096;

/** AppEnvironment has a TEST tier that PushEnvironment doesn't (there is no such thing as a "test" push token) — tests are treated as development-tier for push bookkeeping. */
function toPushEnvironment(appEnvironment: AppEnvironment): PushEnvironment {
  switch (appEnvironment) {
    case AppEnvironment.PRODUCTION:
      return PushEnvironment.PRODUCTION;
    case AppEnvironment.STAGING:
      return PushEnvironment.STAGING;
    default:
      return PushEnvironment.DEVELOPMENT;
  }
}

export interface RegisterDeviceInput {
  userId: string;
  deviceSessionId: string;
  deviceId: string;
  application: PushApplication;
  platform: PushPlatform;
  rawToken: string;
  appVersion?: string;
  osVersion?: string;
  locale?: string;
  notificationsPermission: boolean;
}

/** Safe to return in an HTTP response — never includes the encrypted token, the hash, or any raw token material. */
export interface PublicDevicePushToken {
  id: string;
  application: PushApplication;
  platform: PushPlatform;
  provider: PushProviderType;
  status: string;
  appVersion: string | null;
  osVersion: string | null;
  locale: string | null;
  lastRegisteredAt: Date;
  lastUsedAt: Date | null;
}

function toPublic(row: {
  id: string;
  application: PushApplication;
  platform: PushPlatform;
  provider: PushProviderType;
  status: string;
  appVersion: string | null;
  osVersion: string | null;
  locale: string | null;
  lastRegisteredAt: Date;
  lastUsedAt: Date | null;
}): PublicDevicePushToken {
  return {
    id: row.id,
    application: row.application,
    platform: row.platform,
    provider: row.provider,
    status: row.status,
    appVersion: row.appVersion,
    osVersion: row.osVersion,
    locale: row.locale,
    lastRegisteredAt: row.lastRegisteredAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Application-layer orchestration above DevicePushTokenRepository: validates
 * token format, derives the environment and provider selection server-side
 * (never trusting a client-supplied value for either — see
 * push-provider-selection.ts and docs/notifications/device-tokens.md), and
 * exposes only response-safe DTOs. Role/application matching, rate
 * limiting, and the mass-registration audit event are enforced one layer up
 * in the controller (they need the authenticated JWT payload and request
 * metadata this service doesn't have).
 */
@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: DevicePushTokenRepository,
  ) {}

  private validateTokenFormat(rawToken: string): void {
    if (
      rawToken.length < MIN_TOKEN_LENGTH ||
      rawToken.length > MAX_TOKEN_LENGTH ||
      /\s/.test(rawToken)
    ) {
      throw new BadRequestException({
        code: 'INVALID_PUSH_TOKEN_FORMAT',
        message: 'Push token has an invalid format',
      });
    }
  }

  async registerDevice(
    input: RegisterDeviceInput,
  ): Promise<PublicDevicePushToken> {
    this.validateTokenFormat(input.rawToken);

    const environment =
      this.config.getOrThrow<AppEnvironment>('app.appEnvironment');
    const configuredProvider =
      this.config.getOrThrow<PushProviderType>('push.provider');
    const provider = determinePushProviderType(
      environment,
      input.platform,
      configuredProvider,
    );

    const row = await this.repository.register({
      userId: input.userId,
      deviceSessionId: input.deviceSessionId,
      deviceId: input.deviceId,
      application: input.application,
      platform: input.platform,
      provider,
      environment: toPushEnvironment(environment),
      rawToken: input.rawToken,
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      ...(input.osVersion ? { osVersion: input.osVersion } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      notificationsPermission: input.notificationsPermission,
    });

    return toPublic(row);
  }

  /** Same as registerDevice — a token refresh is just a new registration for the same (user, device, application); DevicePushTokenRepository.register already handles both the idempotent-same-token and the supersede-old-token cases. */
  async refreshDevice(
    input: RegisterDeviceInput,
  ): Promise<PublicDevicePushToken> {
    return this.registerDevice(input);
  }

  async revokeDevice(userId: string, deviceTokenId: string): Promise<void> {
    const row = await this.repository.findByIdForUser(deviceTokenId, userId);
    if (!row) {
      throw new NotFoundException({
        code: 'DEVICE_TOKEN_NOT_FOUND',
        message: 'Device token not found',
      });
    }
    await this.repository.revoke(deviceTokenId, 'USER_REQUESTED');
  }

  async listDevices(userId: string): Promise<PublicDevicePushToken[]> {
    const rows = await this.repository.listActiveForUser(userId);
    return rows.map(toPublic);
  }
}
