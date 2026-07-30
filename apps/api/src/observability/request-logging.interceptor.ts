import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { catchError, tap, throwError } from 'rxjs';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { currentRequestContext, updateRequestContext } from './request-context.js';
import { redactSensitiveData } from './sensitive-data.js';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/**
 * Emits one structured JSON log line per HTTP request, carrying the
 * mandated field list (see docs/staging/security.md): timestamp, level,
 * service, environment, requestId, traceId, userId?, route, method,
 * statusCode, durationMs, errorCode?. Runs every field through
 * redactSensitiveData first, so a call site can never accidentally leak
 * a secret into a log line just by including it in an error payload.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  constructor(private readonly configService: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    if (request.user?.id) {
      updateRequestContext({ userId: request.user.id });
    }

    return next.handle().pipe(
      tap(() => this.log(request, response.statusCode, startedAt)),
      catchError((error: unknown) => {
        const statusCode = this.statusOf(error);
        this.log(request, statusCode, startedAt, error);
        return throwError(() => error);
      }),
    );
  }

  private log(
    request: RequestWithUser,
    statusCode: number,
    startedAt: bigint,
    error?: unknown,
  ): void {
    const requestContext = currentRequestContext();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const errorCode = this.errorCodeOf(error);

    const line = redactSensitiveData({
      level: statusCode >= 500 ? 'error' : 'info',
      service: 'api',
      environment: this.configService.get<string>('app.appEnvironment'),
      requestId: requestContext?.requestId,
      traceId: requestContext?.traceId,
      userId: requestContext?.userId,
      tripId: requestContext?.tripId,
      route: request.route?.path ?? request.path,
      method: request.method,
      statusCode,
      durationMs: Math.round(durationMs),
      ...(errorCode ? { errorCode } : {}),
    }) as Record<string, unknown>;

    this.logger.log(JSON.stringify({ timestamp: new Date().toISOString(), ...line }));
  }

  private statusOf(error: unknown): number {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = Number((error as { status: unknown }).status);
      if (!Number.isNaN(status)) return status;
    }
    return 500;
  }

  private errorCodeOf(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('response' in error)) return undefined;
    const response = (error as { response: unknown }).response;
    if (response && typeof response === 'object' && 'code' in response) {
      return String((response as { code: unknown }).code);
    }
    return undefined;
  }
}
