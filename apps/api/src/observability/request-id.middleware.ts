import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from './request-context.js';

/**
 * Mints (or forwards) a requestId/traceId per request and makes both
 * available to every downstream service via AsyncLocalStorage, so log
 * lines, background jobs, outbox events, and payment operations triggered
 * within the request all share the same identifiers with no per-call-site
 * plumbing. `X-Trace-Id` lets an upstream proxy or client correlate a
 * request across services; `X-Request-ID` is always minted fresh here.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use = (request: Request, response: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    const traceId =
      (request.headers['x-trace-id'] as string | undefined) || requestId;

    response.setHeader('X-Request-ID', requestId);

    runWithRequestContext({ requestId, traceId }, () => {
      next();
    });
  };
}
