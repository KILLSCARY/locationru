import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { SmsWebhookService } from './sms-webhook.service.js';

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

@ApiTags('webhooks')
@Controller('webhooks/sms')
export class SmsWebhookController {
  constructor(private readonly smsWebhookService: SmsWebhookService) {}

  @Post('sms-ru')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive an SMS.RU delivery-status callback' })
  async handleSmsRuWebhook(
    @Req() request: RequestWithRawBody,
    @Query('token') token: string | undefined,
  ): Promise<{ status: 'ok' }> {
    return this.smsWebhookService.handleSmsRuWebhook({
      token,
      ip: request.ip ?? '',
      rawBody: request.rawBody ?? '',
      headers: this.flattenHeaders(request.headers),
    });
  }

  private flattenHeaders(headers: Request['headers']): Record<string, string> {
    const flattened: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') flattened[key] = value;
      else if (Array.isArray(value)) flattened[key] = value.join(', ');
    }
    return flattened;
  }
}
