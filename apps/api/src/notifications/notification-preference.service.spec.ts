import { randomUUID } from 'node:crypto';

import { NotificationCategory } from '../generated/prisma/enums.js';
import { NotificationPreferenceService } from './notification-preference.service.js';

interface FakePreferenceRow {
  userId: string;
  application: string;
  category: NotificationCategory;
  pushEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

interface FakePrivacyRow {
  userId: string;
  previewMode: string;
}

class FakePrisma {
  readonly preferences = new Map<string, FakePreferenceRow>();
  readonly privacySettings = new Map<string, FakePrivacyRow>();

  private key(userId: string, application: string, category: string): string {
    return `${userId}:${application}:${category}`;
  }

  readonly notificationPreference = {
    findMany: async ({
      where,
    }: {
      where: { userId: string; application: string };
    }) =>
      [...this.preferences.values()].filter(
        (row) =>
          row.userId === where.userId && row.application === where.application,
      ),
    findUnique: async ({
      where,
    }: {
      where: {
        userId_application_category: {
          userId: string;
          application: string;
          category: string;
        };
      };
    }) =>
      this.preferences.get(
        this.key(
          where.userId_application_category.userId,
          where.userId_application_category.application,
          where.userId_application_category.category,
        ),
      ) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        userId_application_category: {
          userId: string;
          application: string;
          category: string;
        };
      };
      create: FakePreferenceRow;
      update: Partial<FakePreferenceRow>;
    }) => {
      const key = this.key(
        where.userId_application_category.userId,
        where.userId_application_category.application,
        where.userId_application_category.category,
      );
      const existing = this.preferences.get(key);
      const row = existing ? { ...existing, ...update } : { ...create };
      this.preferences.set(key, row);
      return row;
    },
  };

  readonly notificationPrivacySetting = {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      this.privacySettings.get(where.userId) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId: string };
      create: FakePrivacyRow;
      update: Partial<FakePrivacyRow>;
    }) => {
      const existing = this.privacySettings.get(where.userId);
      const row = existing ? { ...existing, ...update } : { ...create };
      this.privacySettings.set(where.userId, row);
      return row;
    },
  };
}

function buildService() {
  const prisma = new FakePrisma();
  const service = new NotificationPreferenceService(prisma as never);
  return { service, prisma };
}

describe('NotificationPreferenceService', () => {
  const userId = randomUUID();

  it('defaults every category to enabled when no rows exist', async () => {
    const { service } = buildService();

    const result = await service.getPreferences(userId, 'DRIVER');

    expect(result.previewMode).toBe('GENERIC');
    expect(result.categories).toHaveLength(
      Object.values(NotificationCategory).length,
    );
    for (const entry of result.categories) {
      expect(entry.pushEnabled).toBe(true);
      expect(entry.soundEnabled).toBe(true);
      expect(entry.vibrationEnabled).toBe(true);
    }
  });

  it('forces SECURITY and ACTIVE_TRIP to enabled even if a stored row says otherwise', async () => {
    const { service, prisma } = buildService();
    prisma.preferences.set(`${userId}:DRIVER:SECURITY`, {
      userId,
      application: 'DRIVER',
      category: NotificationCategory.SECURITY,
      pushEnabled: false,
      soundEnabled: false,
      vibrationEnabled: false,
    });
    prisma.preferences.set(`${userId}:DRIVER:ACTIVE_TRIP`, {
      userId,
      application: 'DRIVER',
      category: NotificationCategory.ACTIVE_TRIP,
      pushEnabled: false,
      soundEnabled: true,
      vibrationEnabled: true,
    });

    const result = await service.getPreferences(userId, 'DRIVER');

    const security = result.categories.find((c) => c.category === 'SECURITY')!;
    const activeTrip = result.categories.find(
      (c) => c.category === 'ACTIVE_TRIP',
    )!;
    expect(security.pushEnabled).toBe(true);
    expect(activeTrip.pushEnabled).toBe(true);
  });

  it('refuses to actually disable SECURITY or ACTIVE_TRIP via updatePreferences', async () => {
    const { service, prisma } = buildService();

    await service.updatePreferences(userId, 'DRIVER', {
      categories: [
        { category: NotificationCategory.SECURITY, pushEnabled: false },
        { category: NotificationCategory.ACTIVE_TRIP, pushEnabled: false },
      ],
    });

    expect(
      prisma.preferences.get(`${userId}:DRIVER:SECURITY`)!.pushEnabled,
    ).toBe(true);
    expect(
      prisma.preferences.get(`${userId}:DRIVER:ACTIVE_TRIP`)!.pushEnabled,
    ).toBe(true);
  });

  it('updates a disableable category and persists previewMode', async () => {
    const { service, prisma } = buildService();

    const result = await service.updatePreferences(userId, 'PASSENGER', {
      categories: [
        { category: NotificationCategory.PAYMENTS, pushEnabled: false },
      ],
      previewMode: 'HIDDEN',
    });

    expect(
      prisma.preferences.get(`${userId}:PASSENGER:PAYMENTS`)!.pushEnabled,
    ).toBe(false);
    expect(prisma.privacySettings.get(userId)!.previewMode).toBe('HIDDEN');
    expect(result.previewMode).toBe('HIDDEN');
    expect(
      result.categories.find((c) => c.category === 'PAYMENTS')!.pushEnabled,
    ).toBe(false);
  });

  describe('isPushEnabled', () => {
    it('always returns true for SECURITY regardless of stored state', async () => {
      const { service, prisma } = buildService();
      prisma.preferences.set(`${userId}:DRIVER:SECURITY`, {
        userId,
        application: 'DRIVER',
        category: NotificationCategory.SECURITY,
        pushEnabled: false,
        soundEnabled: false,
        vibrationEnabled: false,
      });

      await expect(
        service.isPushEnabled(userId, 'DRIVER', NotificationCategory.SECURITY),
      ).resolves.toBe(true);
    });

    it('defaults to true when no row exists for a disableable category', async () => {
      const { service } = buildService();

      await expect(
        service.isPushEnabled(userId, 'DRIVER', NotificationCategory.PAYMENTS),
      ).resolves.toBe(true);
    });

    it('honors a stored false value for a disableable category', async () => {
      const { service, prisma } = buildService();
      prisma.preferences.set(`${userId}:DRIVER:PAYMENTS`, {
        userId,
        application: 'DRIVER',
        category: NotificationCategory.PAYMENTS,
        pushEnabled: false,
        soundEnabled: true,
        vibrationEnabled: true,
      });

      await expect(
        service.isPushEnabled(userId, 'DRIVER', NotificationCategory.PAYMENTS),
      ).resolves.toBe(false);
    });
  });
});
