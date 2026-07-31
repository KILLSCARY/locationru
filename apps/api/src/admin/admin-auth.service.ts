import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { OtpService } from '../auth/otp.service.js';
import { PhoneNormalizer } from '../auth/phone-normalizer.service.js';
import {
  SMS_PROVIDER,
  type SmsProvider,
} from '../auth/providers/sms-provider.interface.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateAuthBlockDto } from './dto/create-auth-block.dto.js';

interface PageQuery {
  page?: string;
  pageSize?: string;
}

/**
 * Admin visibility and control over the OTP auth subsystem's abuse
 * defenses: security events (read-only), and auth blocks (create/list/
 * unblock). Every mutating action here is written through AdminAuditLog —
 * see admin.service.ts's blockUser/reviewDriver for the same pattern.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly phoneNormalizer: PhoneNormalizer,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async listSecurityEvents(query: PageQuery & { type?: string }) {
    const pagination = this.pagination(query);
    const where = query.type ? { type: query.type as never } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.securityEvent.count({ where }),
    ]);
    return this.page(items, total, pagination);
  }

  async listAuthBlocks(query: PageQuery & { activeOnly?: string }) {
    const pagination = this.pagination(query);
    const where =
      query.activeOnly === 'true'
        ? {
            unblockedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          }
        : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.authBlock.findMany({
        where,
        orderBy: { blockedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.authBlock.count({ where }),
    ]);
    return this.page(items, total, pagination);
  }

  async createBlock(adminId: string, dto: CreateAuthBlockDto) {
    const phoneHash = dto.phone
      ? this.otpService.hashPhone(this.phoneNormalizer.normalize(dto.phone))
      : undefined;
    const deviceId = dto.deviceId;
    const expiresAt = dto.expiresInSeconds
      ? new Date(Date.now() + dto.expiresInSeconds * 1_000)
      : null;

    const block = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.authBlock.create({
        data: {
          ...(phoneHash ? { phoneHash } : {}),
          ...(deviceId ? { deviceId } : {}),
          reason: dto.reason,
          createdByAdminId: adminId,
          ...(expiresAt ? { expiresAt } : {}),
        },
      });
      await transaction.securityEvent.create({
        data: {
          type: phoneHash ? 'PHONE_BLOCKED' : 'DEVICE_BLOCKED',
          ...(phoneHash ? { phoneHash } : {}),
          ...(deviceId ? { deviceId } : {}),
          metadata: { reason: dto.reason, adminId, source: 'admin' },
        },
      });
      await transaction.adminAuditLog.create({
        data: {
          adminId,
          action: 'AUTH_BLOCK_CREATED',
          targetType: phoneHash ? 'PHONE' : 'DEVICE',
          targetId: phoneHash ?? deviceId ?? 'unknown',
          payload: { reason: dto.reason, expiresAt },
        },
      });
      return created;
    });

    if (phoneHash) {
      await this.otpService.adminBlockLogin(
        phoneHash,
        dto.expiresInSeconds ?? null,
      );
    }

    return block;
  }

  async unblock(adminId: string, blockId: string) {
    const block = await this.prisma.authBlock.findUnique({
      where: { id: blockId },
    });
    if (!block) {
      throw new NotFoundException({
        code: 'AUTH_BLOCK_NOT_FOUND',
        message: 'Auth block was not found',
      });
    }
    if (block.unblockedAt) {
      throw new ConflictException({
        code: 'AUTH_BLOCK_ALREADY_LIFTED',
        message: 'This block was already lifted',
      });
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.authBlock.update({
        where: { id: blockId },
        data: { unblockedAt: new Date(), unblockedByAdminId: adminId },
      });
      await transaction.adminAuditLog.create({
        data: {
          adminId,
          action: 'AUTH_BLOCK_LIFTED',
          targetType: block.phoneHash ? 'PHONE' : 'DEVICE',
          targetId: block.phoneHash ?? block.deviceId ?? 'unknown',
          payload: {},
        },
      });
      return result;
    });

    if (block.phoneHash) {
      await this.otpService.adminUnblockLogin(block.phoneHash);
    }

    return updated;
  }

  /** Admin-only — never exposed to a passenger/driver-facing endpoint or health check. */
  async getSmsBalance(): Promise<{ balanceRub: number }> {
    if (!('getBalance' in this.smsProvider)) {
      throw new ServiceUnavailableException({
        code: 'BALANCE_CHECK_UNAVAILABLE',
        message: `The active SMS provider ("${this.smsProvider.name}") does not support a balance check`,
      });
    }
    return (
      this.smsProvider as unknown as {
        getBalance(): Promise<{ balanceRub: number }>;
      }
    ).getBalance();
  }

  private pagination(query: PageQuery) {
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20),
    );
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private page<T>(
    items: T[],
    total: number,
    pagination: { page: number; pageSize: number },
  ) {
    return {
      items,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    };
  }
}
