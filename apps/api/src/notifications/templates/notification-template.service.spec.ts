import { NotificationType } from '../../generated/prisma/enums.js';
import {
  formatPriceKopecks,
  NotificationTemplateService,
} from './notification-template.service.js';

describe('NotificationTemplateService', () => {
  const service = new NotificationTemplateService();

  it('renders DRIVER_NEW_TRIP_AVAILABLE with the formatted price and a driver deep link', () => {
    const rendered = service.render(
      NotificationType.DRIVER_NEW_TRIP_AVAILABLE,
      {
        tripId: 'trip-1',
        formattedPrice: formatPriceKopecks(35_000),
      },
    );

    expect(rendered.title).toBe('Новый заказ рядом');
    expect(rendered.body).toBe(
      'Пассажир предложил 350 ₽. Откройте заказ, чтобы ответить.',
    );
    expect(rendered.deepLink).toBe('resilienttaxi://driver/orders/trip-1');
    expect(rendered.templateVersion).toBe(1);
  });

  it('renders every NotificationType without throwing', () => {
    for (const type of Object.values(NotificationType)) {
      expect(() =>
        service.render(type, {
          tripId: 'trip-1',
          paymentId: 'payment-1',
          formattedPrice: '350 ₽',
          count: 1,
        }),
      ).not.toThrow();
    }
  });

  it('pluralizes PASSENGER_BID_RECEIVED when multiple offers were collapsed', () => {
    const single = service.render(NotificationType.PASSENGER_BID_RECEIVED, {
      tripId: 'trip-1',
      count: 1,
    });
    const multiple = service.render(NotificationType.PASSENGER_BID_RECEIVED, {
      tripId: 'trip-1',
      count: 3,
    });

    expect(single.body).toBe(
      'Получено новое предложение. Откройте приложение для просмотра.',
    );
    expect(multiple.body).toBe(
      'Получено 3 новых предложений. Откройте приложение для просмотра.',
    );
  });

  it('never accepts free-form client text — render only takes (type, structured params)', () => {
    expect(service.render.length).toBeLessThanOrEqual(2);
  });

  it('assigns SECURITY_SESSION_REVOKED to the SECURITY category and gives it a deep link', () => {
    const rendered = service.render(NotificationType.SECURITY_SESSION_REVOKED);
    expect(service.categoryFor(NotificationType.SECURITY_SESSION_REVOKED)).toBe(
      'SECURITY',
    );
    expect(rendered.deepLink).toBe('resilienttaxi://account/security');
  });

  it('returns null deep links for types with no natural entity to open', () => {
    const rendered = service.render(NotificationType.DRIVER_ACCOUNT_APPROVED);
    expect(rendered.deepLink).toBeNull();
  });

  it('formatPriceKopecks rounds to whole rubles', () => {
    expect(formatPriceKopecks(35_000)).toBe('350 ₽');
    expect(formatPriceKopecks(35_049)).toBe('350 ₽');
    expect(formatPriceKopecks(35_051)).toBe('351 ₽');
  });
});
