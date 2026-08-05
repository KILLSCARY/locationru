# Архитектура push-уведомлений

## Разделение ответственности

Модуль `apps/api/src/notifications` устроен так, что домен никогда не знает
про FCM/APNs напрямую:

- **`PushProvider`** (`domain/push-provider.interface.ts`) — единственный
  контракт, которым пользуется остальной код. Он ничего не знает про
  `firebase-admin`; методы — `sendToDevice`/`sendToDevices`/`validateToken`/
  `disableToken`/`healthCheck`.
- Реализации: `DevelopmentPushProvider` (логирует и всегда возвращает
  `ACCEPTED`, никуда не отправляет), `StagingPushProvider` (то же самое, но
  пишет отправки в таблицу для просмотра staging-инструментами), а также
  **`FirebasePushProvider`** — единственное место в кодовой базе, где
  импортируется `firebase-admin`. `ApnsPushProvider` — тонкая обёртка над
  `FirebasePushProvider` (см. `apns.md` — почему нет отдельного APNs SDK).
- **`PushProviderResolver`** (`providers/push-provider.resolver.ts`) выбирает
  реализацию по `application` + `platform` + `PushProviderType` токена +
  `app.appEnvironment` (`development`/`staging`/`production`) — см.
  `push-provider-selection.ts` за точной таблицей решений. Ни один вызывающий
  код (outbox worker, staging-инструменты) не выбирает провайдер вручную.

## Поток данных: от доменного события до пуша на устройстве

```
Trip/Bid/Payment/Auth service
        │  (в той же транзакции, что и доменное изменение)
        ▼
NotificationOutboxService.enqueue()        — пишет NotificationOutboxEvent (PENDING)
        │
        ▼  (отдельный процесс, опрос по push.outboxPollIntervalMs)
NotificationOutboxWorker.processPending()
        │  ├─ проверяет TTL (просрочено → EXPIRED)
        │  ├─ проверяет NotificationPreference (категория выключена → CANCELLED)
        │  ├─ создаёт/обновляет строку Notification (это то, что видно в инбоксе)
        │  ├─ берёт активные DevicePushToken пользователя, группирует по provider
        │  └─ вызывает PushProviderResolver.resolve(provider).sendToDevices(...)
        ▼
NotificationDelivery (по одной строке на токен: PROVIDER_ACCEPTED/TOKEN_INVALID/FAILED_*)
```

Это классический **transactional outbox**: доменное изменение и запись в
outbox — одна транзакция Postgres, поэтому уведомление никогда не «теряется»
из-за падения между шагами. Сама отправка — уже вне этой транзакции,
at-least-once, с ретраями (`retries.md`). `NotificationOutboxService`
дедуплицирует и схлопывает события через `deduplicationKey`/`collapseKey`
(см. `retries.md`, раздел «Collapse/дедупликация»).

## Приоритет, TTL, схлопывание

Три политики закреплены в `NotificationService` (чистый домен, без
обращений к БД) и вынесены в `types.md`:

- **Priority** (`NotificationPriority`: NORMAL/HIGH/CRITICAL) влияет на
  `apns-priority`/`android priority` в `FirebasePushProvider.platformConfig()`.
- **TTL** — три бакета (`NEW_ORDER`/`ACTIVE_TRIP`/`LONG`), значения из
  `.env` (`PUSH_NEW_ORDER_TTL_SECONDS` и т.д.).
- **Collapse** (`NONE`/`SUPERSEDE`/`COLLAPSE_COUNT`) — решает, входит ли
  новое событие в уже существующую PENDING-строку outbox или создаёт новую.

## Android-каналы / группировка

`NotificationCategory` (6 значений) — это одновременно (а) единица
пользовательских настроек (`NotificationPreference`), (б) идентификатор
Android-канала уведомлений. Соответствие `category → channelId` задано в
`FirebasePushProvider`'s `ANDROID_CHANNEL_BY_CATEGORY` и **обязано** совпадать
с тем, что регистрируют клиенты:

| Проект           | Файл                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Backend          | `apps/api/src/notifications/providers/firebase-push.provider.ts` (`ANDROID_CHANNEL_BY_CATEGORY`) |
| driver-android   | `apps/driver-android/core/push/.../PushNotificationChannel.kt`                                   |
| passenger-mobile | `apps/passenger-mobile/src/features/notifications/push-channels-config.ts`                       |

Это критично: когда приложение свёрнуто или убито, FCM показывает
уведомление силами ОС по `channelId` из `android.notification.channelId` —
JS/Kotlin-обработчик (`onMessageReceived`/`addNotificationResponseReceivedListener`)
в этом случае вообще не вызывается. Общего enum между Kotlin/TS/TS нет
(три разных рантайма), поэтому три копии держатся синхронно вручную —
задокументировано как явный инвариант, а не забытая дупликация.

## Модель данных

- `DevicePushToken` — см. `device-tokens.md`.
- `Notification` — то, что видно в инбоксе пользователя (`GET /notifications/inbox`).
- `NotificationDelivery` — одна строка на попытку доставки на конкретный токен.
- `NotificationOutboxEvent` — сама очередь at-least-once доставки.
- `NotificationPreference` / `NotificationPrivacySetting` — пользовательские
  настройки (по категориям + `NotificationPreviewMode`), см. `privacy.md`.

## Локализация

Все тексты — в `NotificationTemplateService` (`templates/notification-template.service.ts`),
единственное место, где формируется copy. Заголовок/текст всегда строятся
только из структурированных параметров (`tripId`, `formattedPrice`, `count`)
— клиент никогда не передаёт свой текст. Сейчас реализована только
русская локаль; поле `locale` в `RegisterDeviceRequestSchema` уже существует
как задел на будущее, но не используется для выбора шаблона.

## Связанные документы

- `types.md` — полный список 24 типов, категории, приоритет/TTL/collapse.
- `device-tokens.md` — жизненный цикл `DevicePushToken`, шифрование.
- `fcm.md` — настройка Firebase Console (действия владельца).
- `apns.md` — почему для iOS нет отдельного APNs-адаптера (Вариант B).
- `deep-links.md` — схема `resilienttaxi://`, allow-list маршрутов.
- `privacy.md` — `PushDataPayloadSchema`, `NotificationPreviewMode`, lock screen.
- `retries.md` — backoff/jitter, dead-letter, collapse/дедупликация подробно.
- `monitoring.md` — 12 метрик, admin-эндпоинты, алерты.
- `../runbooks/push-provider-outage.md` — что делать при отказе FCM/APNs.
