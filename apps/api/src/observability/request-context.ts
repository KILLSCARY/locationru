import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  traceId: string;
  userId?: string;
  tripId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `context` available to every synchronous and asynchronous
 * call inside it (Node's AsyncLocalStorage follows promise chains and
 * timers spawned within `fn`) — so a service called mid-request (e.g.
 * RealtimeOutboxService.enqueueTripEvent, PaymentService.createPayment)
 * automatically logs with the same requestId/traceId as the request that
 * triggered it, with no plumbing at each call site.
 *
 * The one gap this doesn't cover: work that resumes on a timer outside any
 * request (the outbox poller's own dispatch cycle) has no request to
 * inherit from — see RealtimeOutboxService, which mints its own per-cycle
 * id for that case.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attaches userId/tripId to the in-flight request context once known (e.g.
 * once AccessTokenGuard resolves the caller, or once a trip lookup
 * resolves a tripId) — mutates the same context object AsyncLocalStorage
 * is already tracking, so every subsequent log line in this request picks
 * it up without re-threading it through call arguments.
 */
export function updateRequestContext(
  patch: Partial<Pick<RequestContext, 'userId' | 'tripId'>>,
): void {
  const context = storage.getStore();
  if (!context) return;
  Object.assign(context, patch);
}

/**
 * Removes userId/tripId from the in-flight request context (used by
 * ErrorReporter.clearContext). Deletes the keys rather than assigning
 * `undefined` — RequestContext's fields are optional-but-not-nullable
 * under exactOptionalPropertyTypes, so `undefined` isn't a valid value to
 * assign to them.
 */
export function clearRequestContextIdentity(): void {
  const context = storage.getStore();
  if (!context) return;
  delete context.userId;
  delete context.tripId;
}
