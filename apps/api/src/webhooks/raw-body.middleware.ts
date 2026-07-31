import type { NextFunction, Request, Response } from 'express';

/**
 * Captures the exact request body bytes onto `req.rawBody` before any body
 * parser runs, for the one route (the SMS.RU webhook) whose idempotency
 * hash and authenticity check both depend on the untouched raw payload —
 * SMS.RU's callback content-type (JSON vs form-encoded) isn't guaranteed,
 * and re-serializing a parsed body would not reproduce the original bytes.
 * Must be registered before app.useBodyParser so it consumes the stream first.
 */
export function captureRawBody(
  req: Request & { rawBody?: string },
  _res: Response,
  next: NextFunction,
): void {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    data += chunk;
  });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
}
