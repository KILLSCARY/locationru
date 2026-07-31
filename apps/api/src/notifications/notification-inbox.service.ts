import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationInboxResponse } from '@resilient-taxi/contracts';

import { PrismaService } from '../database/prisma.service.js';
import type { PushApplication } from '../generated/prisma/enums.js';
import { MetricsService } from '../observability/metrics.service.js';

interface InboxNotificationRow {
  id: string;
  type: string;
  titleTemplate: string;
  bodyTemplate: string;
  createdAt: Date;
  readAt: Date | null;
  openedAt: Date | null;
  entityType: string;
  entityId: string | null;
  payload: unknown;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async listInbox(
    userId: string,
    application: PushApplication,
    options: { cursor?: string; limit?: number; unreadOnly?: boolean },
  ): Promise<NotificationInboxResponse> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const rows = (await this.prisma.notification.findMany({
      where: {
        userId,
        application,
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    })) as InboxNotificationRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((row) => this.toInboxItem(row)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async markOpened(userId: string, id: string): Promise<void> {
    const notification = await this.findOwned(userId, id);
    if (notification.openedAt) return;

    await this.prisma.notification.update({
      where: { id },
      data: { openedAt: new Date() },
    });
    this.metrics.increment(
      'push_opened_total',
      'Notifications the user opened from a delivered push',
      { application: notification.application, type: notification.type },
    );
  }

  async markRead(userId: string, id: string): Promise<void> {
    const notification = await this.findOwned(userId, id);
    if (notification.readAt) return;

    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(
    userId: string,
    application: PushApplication,
  ): Promise<{ count: number }> {
    return this.prisma.notification.updateMany({
      where: { userId, application, readAt: null },
      data: { readAt: new Date() },
    });
  }

  private async findOwned(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  private toInboxItem(row: InboxNotificationRow) {
    const payload = row.payload as { deepLink?: string | null } | null;
    return {
      id: row.id,
      type: row.type,
      title: row.titleTemplate,
      body: row.bodyTemplate,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
      entityType: row.entityType,
      entityId: row.entityId,
      deepLink: payload?.deepLink ?? null,
    } as NotificationInboxResponse['items'][number];
  }
}
