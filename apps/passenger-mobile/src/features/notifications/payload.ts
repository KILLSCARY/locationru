/**
 * Mirrors the backend's `PushDataPayloadSchema` (`.strict()`,
 * packages/contracts) — the only fields ever present in a push `data`
 * block. Deliberately never contains a token, OTP, phone number, or any
 * other sensitive value; the app re-fetches everything else via
 * REST/WebSocket once it knows which trip/payment this is about. Hand-rolled
 * here rather than importing the contracts package, matching this app's own
 * convention (see src/api/types.ts) of hand-written types instead of a
 * shared schema dependency.
 */
export type PushDataPayload = {
  notificationId: string;
  type: string;
  tripId?: string;
  paymentId?: string;
  sequence?: number;
  deepLink?: string;
  occurredAt?: string;
};

/** Never throws — an incomplete/malformed data payload (e.g. an older client build receiving a newer field set) yields null rather than crashing the notification handler. */
export function parsePushDataPayload(
  data: Record<string, unknown>,
): PushDataPayload | null {
  const notificationId = data.notificationId;
  const type = data.type;
  if (typeof notificationId !== 'string' || typeof type !== 'string')
    return null;

  const sequence = Number(data.sequence);
  return {
    notificationId,
    type,
    ...(typeof data.tripId === 'string' ? { tripId: data.tripId } : {}),
    ...(typeof data.paymentId === 'string'
      ? { paymentId: data.paymentId }
      : {}),
    ...(Number.isFinite(sequence) ? { sequence } : {}),
    ...(typeof data.deepLink === 'string' ? { deepLink: data.deepLink } : {}),
    ...(typeof data.occurredAt === 'string'
      ? { occurredAt: data.occurredAt }
      : {}),
  };
}

/**
 * Translates a `resilienttaxi://trips/{id}` or `resilienttaxi://payments/{id}`
 * deep link into an expo-router path this app actually has a screen for.
 * Only `/trip/[id]` exists today (see app/_layout.tsx) — a payments deep
 * link has nowhere to land yet, so it deliberately returns null rather than
 * guessing at a route that doesn't exist.
 */
export function routeForDeepLink(deepLink: string | undefined): string | null {
  if (!deepLink) return null;
  const match = /^resilienttaxi:\/\/trips\/([^/]+)/.exec(deepLink);
  if (!match) return null;
  return `/trip/${match[1]}`;
}
