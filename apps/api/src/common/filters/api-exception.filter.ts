import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ExceptionBody {
  code?: string;
  details?: unknown;
  error?: string;
  message?: string | string[];
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = this.normalizeExceptionBody(exceptionResponse);

    const payload = {
      statusCode: status,
      code: body.code ?? this.defaultCode(status),
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : (body.message ?? 'Request failed'),
      ...(body.details === undefined ? {} : { details: body.details }),
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    this.logger.error({
      event: 'api.request_failed',
      method: request.method,
      path: request.originalUrl,
      statusCode: status,
      exception:
        exception instanceof Error ? exception.message : String(exception),
    });

    response.status(status).json(payload);
  }

  private normalizeExceptionBody(response: unknown): ExceptionBody {
    if (typeof response === 'string') {
      return { message: response };
    }

    if (response && typeof response === 'object') {
      return response as ExceptionBody;
    }

    return {};
  }

  private defaultCode(status: number): string {
    return `HTTP_${status}`;
  }
}
