import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { WebhookDto } from './dto/webhook.dto.js';
import { PaymentService } from './payment.service.js';

/**
 * Receives payment-gateway webhooks. No access-token guard — the payload
 * signature (verified inside PaymentService.processWebhook, against the
 * active provider's own secret) is the authentication here, exactly like a
 * real gateway webhook. Duplicate deliveries (retries, or the staging
 * "resend the same event" test) are handled idempotently via the unique
 * (provider, providerEventId) constraint on PaymentWebhookEvent.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Receive a payment provider webhook' })
  async receiveWebhook(@Body() body: WebhookDto) {
    try {
      return await this.paymentService.processWebhook(body);
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: error instanceof Error ? error.message : 'Invalid webhook',
      });
    }
  }
}
