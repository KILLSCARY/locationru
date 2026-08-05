/**
 * Field names that must never reach a log line, matched case-insensitively
 * against object keys at any depth. See docs/staging/security.md for the
 * full "never logged" list this enforces:
 * OTP, access/refresh tokens, Authorization header, passport data, bank
 * details, full phone numbers, WebSocket auth token, payment webhook
 * secrets.
 *
 * Short/ambiguous terms (`code`, `otp`, `pin`) are matched as EXACT keys
 * only, so legitimate fields the spec requires in logs — `statusCode`,
 * `errorCode` — are never accidentally redacted. Long/unambiguous terms
 * are matched as substrings since they don't plausibly appear inside any
 * legitimate non-sensitive field name in this codebase, and this also
 * covers camelCase keys like `accessToken`/`refreshToken`.
 */
const EXACT_SENSITIVE_KEYS = new Set([
  'otp',
  'code',
  'otpcode',
  'boardingcode',
  'pin',
]);

const SENSITIVE_SUBSTRINGS = [
  'password',
  'secret',
  'token',
  'authorization',
  'passport',
  'iban',
  'cardnumber',
  'cvv',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (EXACT_SENSITIVE_KEYS.has(lower)) return true;
  return SENSITIVE_SUBSTRINGS.some((substring) => lower.includes(substring));
}

/**
 * Requires a leading `+` (E.164, e.g. `+79995551234`) — every phone number
 * in this codebase is normalized to that shape (see PhoneNormalizer). A
 * plain digit-and-separator run with no `+` isn't restricted to phone
 * numbers — a UUID's digit-heavy segments (e.g. `1728-4483` inside a
 * requestId) match just as well, and masking those would corrupt
 * request/trace IDs instead of protecting anything.
 */
const PHONE_PATTERN = /\+\d[\d\s().-]{7,}\d/g;

const REDACTED = '[REDACTED]';

function maskPhoneNumbers(value: string): string {
  return value.replace(PHONE_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 8) return match;
    return `${match.slice(0, 2)}${'*'.repeat(match.length - 4)}${match.slice(-2)}`;
  });
}

/**
 * Deep-clones `value`, replacing any field whose key looks sensitive with
 * `[REDACTED]` and masking phone-number-shaped strings elsewhere. Used by
 * StructuredLogger before every log line is emitted — call sites never need
 * to remember to mask anything themselves.
 */
export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return maskPhoneNumbers(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskPhoneNumbers(value.message),
      stack: value.stack,
    };
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = isSensitiveKey(key)
        ? REDACTED
        : redactSensitiveData(entryValue, depth + 1);
    }
    return result;
  }

  return value;
}
