import type { VerificationChannel } from '../../generated/prisma/enums.js';

// Re-exported so call sites can `import { VerificationChannel } from
// './sms-provider.interface.js'` without also reaching into the generated
// Prisma module — the provider layer's public surface is this file, Prisma
// is an implementation detail of how the enum happens to be declared (in
// schema.prisma, since OtpRequest.channel is stored with this same type).
// `STAGING` is not a real transport: it exists so StagingSmsProvider can
// report a channel distinct from a genuine `SMS` send, since nothing is
// actually transmitted to a carrier in staging.
export { VerificationChannel } from '../../generated/prisma/enums.js';

/**
 * Normalized across every provider — a concrete adapter's own status
 * vocabulary (see SmsRuProvider) is mapped into this set at the edge, so
 * nothing downstream (OtpService, admin monitoring, metrics) needs to know
 * provider-specific status strings.
 */
export type SmsDeliveryStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'UNKNOWN';

export interface SendVerificationCodeInput {
  phone: string;
  /**
   * The already-generated OTP, passed through so a provider can act on it
   * (e.g. StagingSmsProvider stores it for the admin viewer). A real
   * provider (SmsRuProvider) never logs it — it only ever sends `message`.
   */
  code: string;
  /** Fully rendered by SmsTemplateService — the provider only delivers text, it never composes or knows about templates. */
  message: string;
  channel: VerificationChannel;
  /** Correlates provider-side logs/metrics with the OtpRequest row, without needing the phone or code. */
  requestId: string;
}

export interface SendTransactionalMessageInput {
  phone: string;
  /** Fully rendered by SmsTemplateService. */
  message: string;
}

export interface SendMessageResult {
  providerMessageId?: string;
  status: SmsDeliveryStatus;
}

export interface DeliveryStatusResult {
  providerMessageId: string;
  status: SmsDeliveryStatus;
  updatedAt: Date;
}

export interface NormalizedWebhookEvent {
  providerMessageId: string | null;
  status: SmsDeliveryStatus;
  /** Hash of the raw request body, for idempotent webhook processing. */
  rawEventHash: string;
  occurredAt: Date;
}

export interface SmsHealthCheckResult {
  healthy: boolean;
  detail?: string;
}

/**
 * Every concrete adapter (DevelopmentSmsProvider, StagingSmsProvider,
 * SmsRuProvider) implements this and only this — AuthService/OtpService
 * depend on the interface and the SMS_PROVIDER token, never on a specific
 * vendor. See sms-provider.factory.ts for the only place a concrete class
 * is named.
 */
export interface SmsProvider {
  readonly name: string;
  sendVerificationCode(
    input: SendVerificationCodeInput,
  ): Promise<SendMessageResult>;
  sendTransactionalMessage(
    input: SendTransactionalMessageInput,
  ): Promise<SendMessageResult>;
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult>;
  handleStatusWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<NormalizedWebhookEvent>;
  healthCheck(): Promise<SmsHealthCheckResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
