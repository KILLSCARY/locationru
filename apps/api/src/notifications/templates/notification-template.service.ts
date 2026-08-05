import { Injectable } from '@nestjs/common';

import {
  NotificationCategory,
  NotificationType,
} from '../../generated/prisma/enums.js';

const MAX_TITLE_LENGTH = 128;
const MAX_BODY_LENGTH = 512;

export interface NotificationTemplateParams {
  tripId?: string;
  paymentId?: string;
  /** Pre-formatted display price, e.g. "350 ₽" — see formatPriceKopecks(). Never a raw kopecks integer in copy. */
  formattedPrice?: string;
  /** Set when a burst of the same event was collapsed into one notification — see NotificationService's collapse strategy. */
  count?: number;
}

interface NotificationTemplateDefinition {
  version: number;
  category: NotificationCategory;
  title: (params: NotificationTemplateParams) => string;
  body: (params: NotificationTemplateParams) => string;
  /** Returns null when the type has no natural deep-link target (account/system notices). */
  deepLink: (params: NotificationTemplateParams) => string | null;
}

export interface RenderedNotificationTemplate {
  title: string;
  body: string;
  templateVersion: number;
  deepLink: string | null;
}

/** `kopecks` → a display string like "350 ₽" — the only place a raw money integer becomes user-facing copy. */
export function formatPriceKopecks(kopecks: number): string {
  return `${Math.round(kopecks / 100)} ₽`;
}

/**
 * Centralized, versioned push copy — the only place NotificationType text
 * is composed. A client can never supply its own title/body (no such
 * parameter exists on renderVerificationCode's signature-equivalent here
 * either); only structured params (tripId, a pre-formatted price, etc.)
 * flow in. Locale is a seam for the future — only `ru` is implemented, see
 * docs/notifications/architecture.md.
 */
const TEMPLATES: Record<NotificationType, NotificationTemplateDefinition> = {
  [NotificationType.DRIVER_NEW_TRIP_AVAILABLE]: {
    version: 1,
    category: NotificationCategory.TRIP_OFFERS,
    title: () => 'Новый заказ рядом',
    body: (p) =>
      `Пассажир предложил ${p.formattedPrice}. Откройте заказ, чтобы ответить.`,
    deepLink: (p) => `resilienttaxi://driver/orders/${p.tripId}`,
  },
  [NotificationType.DRIVER_BID_ACCEPTED]: {
    version: 1,
    category: NotificationCategory.TRIP_OFFERS,
    title: () => 'Ваше предложение принято',
    body: () => 'Пассажир выбрал вас. Подтвердите выезд.',
    deepLink: (p) => `resilienttaxi://driver/active-trip/${p.tripId}`,
  },
  [NotificationType.DRIVER_BID_REJECTED]: {
    version: 1,
    category: NotificationCategory.TRIP_OFFERS,
    title: () => 'Предложение не принято',
    body: () => 'Пассажир выбрал другого водителя. Заказ больше не доступен.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_TRIP_CANCELLED]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Поездка отменена',
    body: () => 'Пассажир отменил поездку.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_PAYMENT_RESERVED]: {
    version: 1,
    category: NotificationCategory.PAYMENTS,
    title: () => 'Оплата зарезервирована',
    body: () => 'Сумма поездки зарезервирована у пассажира.',
    deepLink: (p) => `resilienttaxi://driver/active-trip/${p.tripId}`,
  },
  [NotificationType.DRIVER_PICKUP_REMINDER]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Не забудьте забрать пассажира',
    body: () => 'Пассажир ожидает в точке подачи.',
    deepLink: (p) => `resilienttaxi://driver/active-trip/${p.tripId}`,
  },
  [NotificationType.DRIVER_LOCATION_DEGRADED]: {
    version: 1,
    category: NotificationCategory.DRIVER_OPERATIONS,
    title: () => 'Проблема с геолокацией',
    body: () => 'Проверьте сигнал GPS — это может повлиять на поиск заказов.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_DOCUMENT_EXPIRING]: {
    version: 1,
    category: NotificationCategory.ACCOUNT,
    title: () => 'Истекает срок действия документа',
    body: () =>
      'Обновите документы в личном кабинете, чтобы продолжать принимать заказы.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_ACCOUNT_APPROVED]: {
    version: 1,
    category: NotificationCategory.ACCOUNT,
    title: () => 'Аккаунт подтверждён',
    body: () => 'Вы можете выходить на линию и принимать заказы.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_ACCOUNT_REJECTED]: {
    version: 1,
    category: NotificationCategory.ACCOUNT,
    title: () => 'Требуется обновить документы',
    body: () => 'Проверка не пройдена. Откройте приложение для деталей.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_PAYOUT_COMPLETED]: {
    version: 1,
    category: NotificationCategory.PAYMENTS,
    title: () => 'Выплата выполнена',
    body: () => 'Средства за поездку переведены вам.',
    deepLink: () => null,
  },
  [NotificationType.DRIVER_PAYOUT_FAILED]: {
    version: 1,
    category: NotificationCategory.PAYMENTS,
    title: () => 'Не удалось выполнить выплату',
    body: () => 'Проверьте реквизиты в личном кабинете.',
    deepLink: () => null,
  },
  [NotificationType.PASSENGER_BID_RECEIVED]: {
    version: 1,
    category: NotificationCategory.TRIP_OFFERS,
    title: () => 'Водитель предложил цену',
    body: (p) =>
      p.count && p.count > 1
        ? `Получено ${p.count} новых предложений. Откройте приложение для просмотра.`
        : 'Получено новое предложение. Откройте приложение для просмотра.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}/bids`,
  },
  [NotificationType.PASSENGER_DRIVER_SELECTED]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Водитель назначен',
    body: () => 'Водитель принял вашу поездку и уже в пути.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_DRIVER_EN_ROUTE]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Водитель в пути',
    body: () => 'Водитель едет к месту подачи.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_DRIVER_ARRIVED]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Водитель прибыл',
    body: () => 'Машина ожидает в точке подачи.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_TRIP_STARTED]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Поездка началась',
    body: () => 'Хорошей поездки!',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_TRIP_COMPLETED]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Поездка завершена',
    body: () => 'Спасибо, что выбрали Resilient Taxi.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_TRIP_CANCELLED]: {
    version: 1,
    category: NotificationCategory.ACTIVE_TRIP,
    title: () => 'Поездка отменена',
    body: () => 'Ваша поездка была отменена.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_PAYMENT_RESERVED]: {
    version: 1,
    category: NotificationCategory.PAYMENTS,
    title: () => 'Оплата зарезервирована',
    body: () => 'Сумма поездки зарезервирована на вашей карте.',
    deepLink: (p) => `resilienttaxi://trips/${p.tripId}`,
  },
  [NotificationType.PASSENGER_PAYMENT_FAILED]: {
    version: 1,
    category: NotificationCategory.PAYMENTS,
    title: () => 'Не удалось подтвердить оплату',
    body: () => 'Откройте приложение и выберите другой способ оплаты.',
    deepLink: (p) => `resilienttaxi://payments/${p.paymentId}`,
  },
  [NotificationType.PASSENGER_REFUND_COMPLETED]: {
    version: 1,
    category: NotificationCategory.PAYMENTS,
    title: () => 'Возврат выполнен',
    body: () => 'Средства возвращены. Проверьте баланс в приложении.',
    deepLink: (p) => `resilienttaxi://payments/${p.paymentId}`,
  },
  [NotificationType.SECURITY_SESSION_REVOKED]: {
    version: 1,
    category: NotificationCategory.SECURITY,
    title: () => 'Сессия завершена',
    body: () =>
      'Вход выполнен на новом устройстве, либо сессия отозвана администратором.',
    deepLink: () => 'resilienttaxi://account/security',
  },
  [NotificationType.SYSTEM_SERVICE_NOTICE]: {
    version: 1,
    category: NotificationCategory.ACCOUNT,
    title: () => 'Уведомление сервиса',
    body: () => 'Откройте приложение для подробностей.',
    deepLink: () => null,
  },
};

@Injectable()
export class NotificationTemplateService {
  render(
    type: NotificationType,
    params: NotificationTemplateParams = {},
  ): RenderedNotificationTemplate {
    const template = TEMPLATES[type];
    const title = template.title(params);
    const body = template.body(params);

    if (title.length > MAX_TITLE_LENGTH) {
      throw new Error(
        `Rendered notification title for ${type} exceeds ${MAX_TITLE_LENGTH} chars`,
      );
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error(
        `Rendered notification body for ${type} exceeds ${MAX_BODY_LENGTH} chars`,
      );
    }

    return {
      title,
      body,
      templateVersion: template.version,
      deepLink: template.deepLink(params),
    };
  }

  categoryFor(type: NotificationType): NotificationCategory {
    return TEMPLATES[type].category;
  }
}
