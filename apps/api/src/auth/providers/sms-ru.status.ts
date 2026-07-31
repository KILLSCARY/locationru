import type { SmsDeliveryStatus } from './sms-provider.interface.js';

/**
 * SMS.RU per-message status codes (returned by /sms/send, /sms/status, and
 * the status callback) mapped onto the provider-agnostic SmsDeliveryStatus
 * vocabulary. Sourced from SMS.RU's published API reference; re-verify
 * against a live send during the staging SMS.RU check (pnpm
 * staging:test:sms) since a gateway can add/renumber codes over time — see
 * docs/auth/sms-ru-setup.md.
 */
const SMS_RU_STATUS_CODE_MAP: Record<number, SmsDeliveryStatus> = {
  100: 'QUEUED', // accepted for sending
  101: 'SENT', // handed to the mobile operator
  102: 'DELIVERED', // delivered to the handset
  103: 'FAILED', // could not be delivered
  104: 'EXPIRED', // validity period expired before delivery
  105: 'REJECTED', // rejected by the operator
  106: 'REJECTED', // rejected: invalid number
  107: 'REJECTED', // rejected: landline number
  108: 'FAILED', // deleted before sending
};

export function normalizeSmsRuStatusCode(
  statusCode: number | undefined,
): SmsDeliveryStatus {
  if (statusCode === undefined) return 'UNKNOWN';
  return SMS_RU_STATUS_CODE_MAP[statusCode] ?? 'UNKNOWN';
}
