import { Injectable } from '@nestjs/common';
import type {
  NotificationPreferenceEntry,
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
} from '@resilient-taxi/contracts';

import { PrismaService } from '../database/prisma.service.js';
import {
  NotificationCategory,
  type PushApplication,
} from '../generated/prisma/enums.js';

/**
 * Categories the user cannot fully disable within the app, regardless of
 * what's stored: SECURITY (session-revocation etc. — always CRITICAL
 * priority, see NotificationService) and ACTIVE_TRIP (in-progress trip
 * status changes the rider/driver needs to see). OS-level notification
 * permission still overrides everything — this only governs the in-app
 * toggle.
 */
const ALWAYS_ENABLED_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.SECURITY,
  NotificationCategory.ACTIVE_TRIP,
]);

@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(
    userId: string,
    application: PushApplication,
  ): Promise<NotificationPreferencesResponse> {
    const [rows, privacySetting] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { userId, application },
      }),
      this.prisma.notificationPrivacySetting.findUnique({
        where: { userId },
      }),
    ]);
    const byCategory = new Map(rows.map((row) => [row.category, row]));

    const categories: NotificationPreferenceEntry[] = Object.values(
      NotificationCategory,
    ).map((category) => {
      const row = byCategory.get(category);
      return {
        category,
        pushEnabled: ALWAYS_ENABLED_CATEGORIES.has(category)
          ? true
          : (row?.pushEnabled ?? true),
        soundEnabled: row?.soundEnabled ?? true,
        vibrationEnabled: row?.vibrationEnabled ?? true,
      };
    });

    return {
      categories,
      previewMode: privacySetting?.previewMode ?? 'GENERIC',
    };
  }

  async updatePreferences(
    userId: string,
    application: PushApplication,
    input: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferencesResponse> {
    for (const update of input.categories) {
      const pushEnabled = ALWAYS_ENABLED_CATEGORIES.has(update.category)
        ? true
        : (update.pushEnabled ?? true);
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_application_category: {
            userId,
            application,
            category: update.category,
          },
        },
        create: {
          userId,
          application,
          category: update.category,
          pushEnabled,
          soundEnabled: update.soundEnabled ?? true,
          vibrationEnabled: update.vibrationEnabled ?? true,
        },
        update: {
          pushEnabled,
          ...(update.soundEnabled !== undefined
            ? { soundEnabled: update.soundEnabled }
            : {}),
          ...(update.vibrationEnabled !== undefined
            ? { vibrationEnabled: update.vibrationEnabled }
            : {}),
        },
      });
    }

    if (input.previewMode) {
      await this.prisma.notificationPrivacySetting.upsert({
        where: { userId },
        create: { userId, previewMode: input.previewMode },
        update: { previewMode: input.previewMode },
      });
    }

    return this.getPreferences(userId, application);
  }

  /** Used by NotificationOutboxWorker right before sending — SECURITY/ACTIVE_TRIP always return true regardless of stored state. */
  async isPushEnabled(
    userId: string,
    application: PushApplication,
    category: NotificationCategory,
  ): Promise<boolean> {
    if (ALWAYS_ENABLED_CATEGORIES.has(category)) return true;

    const row = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_application_category: { userId, application, category },
      },
    });
    return row?.pushEnabled ?? true;
  }
}
