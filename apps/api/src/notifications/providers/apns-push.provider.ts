import { Injectable } from '@nestjs/common';

import { PushProviderType } from '../../generated/prisma/enums.js';
import type {
  PushHealthCheckResult,
  PushProvider,
  SendResult,
  SendToDeviceInput,
  SendToDevicesInput,
  SendToDevicesResult,
} from '../domain/push-provider.interface.js';
import { FirebasePushProvider } from './firebase-push.provider.js';

/**
 * Routing decision (Task 28, section 20): **Variant B** — backend → FCM →
 * APNs, not a direct APNs client. iOS passenger-mobile registers its push
 * token through Firebase's iOS SDK (which itself wraps the raw APNs device
 * token), so the token our backend receives for an iOS device is already
 * an FCM registration token, sent through the same Firebase Admin SDK call
 * as Android — `FirebasePushProvider.platformConfig()` already sets the
 * `apns` block (priority/expiration/collapse-id/push-type) on every
 * message, which is what actually reaches the device over APNs.
 *
 * This class exists so `PushProviderType.APNS` stays a meaningful,
 * separately-bookkept value (an iOS token is recorded as APNS at
 * registration, distinct from an Android FCM token) without a second,
 * parallel wire protocol implementation to maintain. It is a deliberate
 * choice, not a stub standing in for undone work — see
 * docs/notifications/apns.md for the trade-off (no separate .p8 key /
 * sandbox-vs-production cert management to run, at the cost of every send
 * depending on Firebase's own APNs relay being up).
 */
@Injectable()
export class ApnsPushProvider implements PushProvider {
  readonly name = PushProviderType.APNS;

  constructor(private readonly firebase: FirebasePushProvider) {}

  sendToDevice(input: SendToDeviceInput): Promise<SendResult> {
    return this.firebase.sendToDevice(input);
  }

  sendToDevices(input: SendToDevicesInput): Promise<SendToDevicesResult> {
    return this.firebase.sendToDevices(input);
  }

  validateToken(rawToken: string): boolean {
    return this.firebase.validateToken(rawToken);
  }

  disableToken(): Promise<void> {
    return this.firebase.disableToken();
  }

  healthCheck(): Promise<PushHealthCheckResult> {
    return this.firebase.healthCheck();
  }
}
