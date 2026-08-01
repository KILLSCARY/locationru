# Типы уведомлений

Источник истины: `NotificationTypeSchema` в `packages/contracts/src/index.ts`
(потребляется как `NotificationType`/`NotificationCategory` enum в Prisma-схеме
и в `apps/api/src/generated/prisma/enums.js`). Ровно **24 значения**, маркетинг
принципиально исключён — в модуле нет ни одного типа, предназначенного для
привлечения/ретеншена, только операционные/платёжные/security-уведомления.

Приоритет, TTL-бакет и стратегия схлопывания определяются чистыми функциями
`NotificationService.resolvePriority/resolveTtlSeconds/resolveCollapseStrategy`
(`apps/api/src/notifications/notification.service.ts`) — таблица ниже это
их точное отражение, а не отдельная документация «как должно быть».

TTL-бакеты (значения — `.env`, см. `fcm.md`/корневой `.env.example`):
`NEW_ORDER` = `PUSH_NEW_ORDER_TTL_SECONDS` (по умолчанию 30 c),
`ACTIVE_TRIP` = `PUSH_ACTIVE_TRIP_TTL_SECONDS` (300 c),
`LONG` = `PUSH_PAYMENT_TTL_SECONDS` (86400 c).

| Тип | Категория | Приоритет | TTL-бакет | Collapse | Deep link |
|---|---|---|---|---|---|
| `DRIVER_NEW_TRIP_AVAILABLE` | TRIP_OFFERS | HIGH | NEW_ORDER | SUPERSEDE | `driver/orders/{tripId}` |
| `DRIVER_BID_ACCEPTED` | TRIP_OFFERS | HIGH | ACTIVE_TRIP | NONE | `driver/active-trip/{tripId}` |
| `DRIVER_BID_REJECTED` | TRIP_OFFERS | NORMAL | ACTIVE_TRIP | NONE | — |
| `DRIVER_TRIP_CANCELLED` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | — |
| `DRIVER_PAYMENT_RESERVED` | PAYMENTS | HIGH | ACTIVE_TRIP | SUPERSEDE | `driver/active-trip/{tripId}` |
| `DRIVER_PICKUP_REMINDER` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | `driver/active-trip/{tripId}` |
| `DRIVER_LOCATION_DEGRADED` | DRIVER_OPERATIONS | NORMAL | LONG | NONE | — |
| `DRIVER_DOCUMENT_EXPIRING` | ACCOUNT | NORMAL | LONG | NONE | — |
| `DRIVER_ACCOUNT_APPROVED` | ACCOUNT | NORMAL | LONG | NONE | — |
| `DRIVER_ACCOUNT_REJECTED` | ACCOUNT | NORMAL | LONG | NONE | — |
| `DRIVER_PAYOUT_COMPLETED` | PAYMENTS | NORMAL | LONG | NONE | — |
| `DRIVER_PAYOUT_FAILED` | PAYMENTS | NORMAL | LONG | NONE | — |
| `PASSENGER_BID_RECEIVED` | TRIP_OFFERS | HIGH | ACTIVE_TRIP | COLLAPSE_COUNT | `trips/{tripId}/bids` |
| `PASSENGER_DRIVER_SELECTED` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_DRIVER_EN_ROUTE` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_DRIVER_ARRIVED` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_TRIP_STARTED` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_TRIP_COMPLETED` | ACTIVE_TRIP | NORMAL | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_TRIP_CANCELLED` | ACTIVE_TRIP | HIGH | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_PAYMENT_RESERVED` | PAYMENTS | NORMAL | ACTIVE_TRIP | SUPERSEDE | `trips/{tripId}` |
| `PASSENGER_PAYMENT_FAILED` | PAYMENTS | NORMAL | LONG | NONE | `payments/{paymentId}` |
| `PASSENGER_REFUND_COMPLETED` | PAYMENTS | NORMAL | LONG | NONE | `payments/{paymentId}` |
| `SECURITY_SESSION_REVOKED` | SECURITY | **CRITICAL** | LONG | NONE | `account/security` |
| `SYSTEM_SERVICE_NOTICE` | ACCOUNT | NORMAL | LONG | NONE | — |

Приоритет по умолчанию — NORMAL; HIGH назначен явному списку
(`HIGH_PRIORITY_TYPES` — новые заказы, изменения активной поездки в реальном
времени); CRITICAL зарезервирован единственно за `SECURITY_SESSION_REVOKED`
(`CRITICAL_TYPES`) и никогда не выдаётся другому типу.

## Категории (6 значений)

`NotificationCategory` — одновременно единица пользовательских настроек
(`NotificationPreference`) и идентификатор Android-канала (см.
`architecture.md`): `TRIP_OFFERS`, `ACTIVE_TRIP`, `PAYMENTS`,
`DRIVER_OPERATIONS`, `ACCOUNT`, `SECURITY`.

`SECURITY` и `ACTIVE_TRIP` — единственные категории, которые пользователь
не может полностью отключить в приложении (см. `privacy.md` и
`notification-preference.service.ts`, `ALWAYS_ENABLED_CATEGORIES`).

## Collapse-стратегии

Подробный алгоритм — в `retries.md`. Кратко: `NONE` — каждое событие своя
запись; `SUPERSEDE` — новое событие того же (userId, type, entityId) отменяет
ещё не отправленную предыдущую запись того же типа (актуальный статус поездки
важнее устаревшего); `COLLAPSE_COUNT` — повторяющиеся события мержатся в одну
запись с перерендером текста («Получено N предложений») — применяется только
к `PASSENGER_BID_RECEIVED`.
