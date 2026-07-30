import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PhoneNormalizer } from '../auth/phone-normalizer.service.js';
import { stagingOtpLookupKey } from '../auth/providers/staging-sms.provider.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RealtimeOutboxStatus } from '../generated/prisma/enums.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../payments/payment-provider.js';
import { PaymentService } from '../payments/payment.service.js';
import type { StagingPaymentProvider } from '../payments/staging-payment.provider.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { RedisService } from '../redis/redis.service.js';
import { STAGING_TEST_PASSENGER_PHONE } from './staging-test-accounts.js';

function maskPhone(phone: string): string {
  return phone.length > 4
    ? `${phone.slice(0, -4).replace(/\d/g, '*')}${phone.slice(-4)}`
    : phone;
}

@Injectable()
export class StagingToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly phoneNormalizer: PhoneNormalizer,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly paymentService: PaymentService,
    private readonly outbox: RealtimeOutboxService,
  ) {}

  async viewOtp(adminId: string, rawPhone: string) {
    const phone = this.phoneNormalizer.normalize(rawPhone);
    const [code, ttlSeconds] = await Promise.all([
      this.redis.get(stagingOtpLookupKey(phone)),
      this.redis.getTtl(stagingOtpLookupKey(phone)),
    ]);

    // No natural UUID target for "a phone number" — this audit entry's
    // payload (masked phone) is the record of what was looked up.
    await this.audit(
      adminId,
      'staging.otp.viewed',
      'StagingOtp',
      randomUUID(),
      {
        phone: maskPhone(phone),
        found: code !== null,
      },
    );

    return {
      phone,
      code,
      expiresInSeconds: code !== null && ttlSeconds > 0 ? ttlSeconds : null,
    };
  }

  async setPaymentScenario(
    adminId: string,
    tripId: string,
    scenario: string,
  ): Promise<void> {
    const provider = this.requireStagingPaymentProvider();
    await provider.setScenarioOverride(
      tripId,
      scenario as Parameters<StagingPaymentProvider['setScenarioOverride']>[1],
    );
    await this.audit(adminId, 'staging.payment_scenario.set', 'Trip', tripId, {
      scenario,
    });
  }

  async clearPaymentScenario(adminId: string, tripId: string): Promise<void> {
    const provider = this.requireStagingPaymentProvider();
    await provider.setScenarioOverride(tripId, null);
    await this.audit(
      adminId,
      'staging.payment_scenario.cleared',
      'Trip',
      tripId,
      {},
    );
  }

  async simulateWebhook(
    adminId: string,
    input: {
      tripId: string;
      type:
        | 'payment.authorized'
        | 'payment.captured'
        | 'payment.failed'
        | 'payment.refunded';
      repeatLastEventId?: boolean;
    },
  ) {
    const provider = this.requireStagingPaymentProvider();
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { tripId: input.tripId },
    });
    if (!intent) {
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_FOUND',
        message: 'This trip has no payment intent yet',
      });
    }

    const lastEventKey = `staging:payment-last-event:${input.tripId}`;
    const eventId = input.repeatLastEventId
      ? ((await this.redis.get(lastEventKey)) ?? randomUUID())
      : randomUUID();

    const { payload, signature } = provider.buildWebhook({
      paymentId: intent.providerPaymentId,
      type: input.type,
      eventId,
    });
    await this.redis.setWithTtl(lastEventKey, eventId, 24 * 60 * 60);

    const result = await this.paymentService.processWebhook({
      payload,
      signature,
    });

    await this.audit(
      adminId,
      'staging.webhook.simulated',
      'Trip',
      input.tripId,
      {
        type: input.type,
        eventId,
        repeated: Boolean(input.repeatLastEventId),
        duplicate: result.duplicate,
      },
    );

    return { ...result, eventId };
  }

  async listOutbox(limit: number) {
    return this.prisma.realtimeOutboxEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async retryOutboxEvent(adminId: string, eventId: string): Promise<void> {
    const updated = await this.prisma.realtimeOutboxEvent.updateMany({
      where: { id: eventId, status: RealtimeOutboxStatus.PENDING },
      data: { availableAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException({
        code: 'OUTBOX_EVENT_NOT_RETRYABLE',
        message: 'Event was not found or is not in a retryable state',
      });
    }
    await this.outbox.dispatchPending();
    await this.audit(
      adminId,
      'staging.outbox.retried',
      'RealtimeOutboxEvent',
      eventId,
      {},
    );
  }

  /**
   * Deletes only trips created by the fixed staging test-passenger account
   * (see staging-test-accounts.ts) — never a blanket wipe of staging data.
   */
  async resetTestData(
    adminId: string,
    confirm: boolean,
  ): Promise<{ deletedTrips: number }> {
    if (!confirm) {
      throw new BadRequestException({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Pass { "confirm": true } to reset staging test data',
      });
    }

    const passenger = await this.prisma.user.findUnique({
      where: { phone: STAGING_TEST_PASSENGER_PHONE },
    });
    if (!passenger) {
      return { deletedTrips: 0 };
    }

    const result = await this.prisma.trip.deleteMany({
      where: { passengerId: passenger.id },
    });

    await this.audit(adminId, 'staging.test_data.reset', 'User', passenger.id, {
      deletedTrips: result.count,
    });

    return { deletedTrips: result.count };
  }

  /**
   * Marks a driver's most recent location `stale`, for testing how
   * clients handle a driver whose position has gone quiet — without
   * waiting for DRIVER_LOCATIONS_STALE_AFTER_SECONDS to elapse for real.
   */
  async markLatestLocationStale(
    adminId: string,
    driverId: string,
  ): Promise<{ locationId: string }> {
    const latest = await this.prisma.driverLocation.findFirst({
      where: { driverId },
      orderBy: { recordedAt: 'desc' },
      select: { id: true },
    });
    if (!latest) {
      throw new NotFoundException({
        code: 'NO_LOCATION_FOUND',
        message: 'This driver has no reported location yet',
      });
    }

    await this.prisma.driverLocation.update({
      where: { id: latest.id },
      data: { stale: true },
    });

    await this.audit(
      adminId,
      'staging.location.marked_stale',
      'DriverLocation',
      latest.id,
      {
        driverId,
      },
    );

    return { locationId: latest.id };
  }

  /**
   * Inserts a location far from the driver's last reported position, to
   * exercise how clients render/react to an implausible jump. Reported as
   * confidence HIGH / not suspected spoofing — the same way a real,
   * anomalous GPS reading would arrive — rather than pre-filtered, so the
   * jump is actually visible to whatever is testing it.
   */
  async emulateGpsJump(
    adminId: string,
    driverId: string,
    offsetDegrees = 0.5,
  ): Promise<{ locationId: string }> {
    const latest = await this.prisma.driverLocation.findFirst({
      where: { driverId },
      orderBy: { recordedAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
      },
    });
    if (!latest) {
      throw new NotFoundException({
        code: 'NO_LOCATION_FOUND',
        message: 'This driver has no reported location yet — submit one first',
      });
    }
    const [previousPoint] = await this.prisma.$queryRawUnsafe<
      Array<{ latitude: number; longitude: number }>
    >(
      `SELECT ST_Y("location"::geometry) AS latitude, ST_X("location"::geometry) AS longitude
       FROM "driver_locations" WHERE "id" = $1`,
      latest.id,
    );
    if (!previousPoint) {
      throw new NotFoundException({
        code: 'NO_LOCATION_FOUND',
        message: 'This driver has no reported location yet — submit one first',
      });
    }

    const id = randomUUID();
    await this.prisma.$queryRawUnsafe(
      `INSERT INTO "driver_locations" (
          "id", "driverId", "deviceId", "recordedAt", "location", "accuracyMeters",
          "provider", "confidence", "suspectedSpoofing", "stale"
       ) VALUES (
          $1, $2, $3, now(), ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6,
          $7, $8::"DriverLocationConfidence", $9, $10
       )`,
      id,
      driverId,
      latest.deviceId,
      previousPoint.longitude + offsetDegrees,
      previousPoint.latitude + offsetDegrees,
      8,
      'staging-tools',
      'HIGH',
      false,
      false,
    );

    await this.audit(
      adminId,
      'staging.location.gps_jump_emulated',
      'DriverLocation',
      id,
      {
        driverId,
        offsetDegrees,
      },
    );

    return { locationId: id };
  }

  private requireStagingPaymentProvider(): StagingPaymentProvider {
    if (this.paymentProvider.name !== 'staging') {
      throw new BadRequestException({
        code: 'STAGING_PAYMENT_PROVIDER_INACTIVE',
        message:
          'This tool requires PAYMENTS_PROVIDER=staging; the active provider is ' +
          `"${this.paymentProvider.name}"`,
      });
    }
    return this.paymentProvider as StagingPaymentProvider;
  }

  private async audit(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType,
        targetId,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
