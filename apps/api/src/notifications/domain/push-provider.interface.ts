import type {
  PushPlatform,
  PushProviderType,
} from '../../generated/prisma/enums.js';

/**
 * Every concrete adapter (DevelopmentPushProvider, StagingPushProvider,
 * FirebasePushProvider, ApnsPushProvider) implements this and only this —
 * NotificationSenderService depends on the interface and the token
 * selected by push-provider.factory.ts, never on a vendor SDK directly.
 * Domain/application code must never import `firebase-admin` or an APNs
 * client — that's confined to providers/.
 */
export interface PushProvider {
  readonly name: PushProviderType;
  sendToDevice(input: SendToDeviceInput): Promise<SendResult>;
  sendToDevices(input: SendToDevicesInput): Promise<SendToDevicesResult>;
  /** Format/shape check only — never a network call. Actual validity is only known once a send is attempted. */
  validateToken(rawToken: string): boolean;
  disableToken(rawToken: string): Promise<void>;
  healthCheck(): Promise<PushHealthCheckResult>;
}

export type PushDataPayload = Record<string, string>;

export interface SendToDeviceInput {
  rawToken: string;
  platform: PushPlatform;
  title: string;
  body: string;
  data: PushDataPayload;
  priority: 'NORMAL' | 'HIGH';
  ttlSeconds: number;
  collapseKey?: string;
}

export interface DeviceSendTarget {
  devicePushTokenId: string;
  rawToken: string;
  platform: PushPlatform;
}

export interface SendToDevicesInput {
  targets: DeviceSendTarget[];
  title: string;
  body: string;
  data: PushDataPayload;
  priority: 'NORMAL' | 'HIGH';
  ttlSeconds: number;
  collapseKey?: string;
}

export type SendOutcomeStatus = 'ACCEPTED' | 'TOKEN_INVALID' | 'FAILED_TEMPORARY' | 'FAILED_PERMANENT';

export interface SendResult {
  status: SendOutcomeStatus;
  providerMessageId?: string;
  errorCode?: string;
}

export interface SendToDevicesResult {
  /** One result per input target, same order as `targets`. */
  results: Array<SendResult & { devicePushTokenId: string }>;
}

export interface PushHealthCheckResult {
  healthy: boolean;
  detail?: string;
}
