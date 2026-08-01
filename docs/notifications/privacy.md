# Приватность push-уведомлений

## `PushDataPayloadSchema` — строгий allow-list полей

`packages/contracts/src/index.ts` (`PushDataPayloadSchema`) описывает
**всё**, что реально может оказаться в `data`-блоке нативного push-сообщения:

```
notificationId: uuid
type: NotificationType
tripId?: uuid
bidId?: uuid | null
paymentId?: uuid | null
sequence: number (int, >= 0)
deepLink?: string (<= 512)
occurredAt: datetime
```

Схема помечена `.strict()` — **любое** поле, не входящее в этот список,
приводит к ошибке валидации, а не к тихому отбрасыванию. Тест
`contracts.test.mjs` («rejects any push data payload field beyond the
allowed minimal set») явно прогоняет список заведомо чувствительных ключей
(`accessToken`, `refreshToken`, `otp`, `phone`, `bankAccount`,
`webhookSecret`) и проверяет, что каждый из них ломает валидацию.
`NotificationOutboxWorker.sendEvent()` строит `dataPayload` через
`PushDataPayloadSchema.parse(...)` перед отправкой — если бы где-то в коде
по ошибке попытались добавить лишнее поле, отправка упала бы с исключением
ещё до вызова провайдера, а не отправила бы лишние данные.

Явно **не входит** в push-payload и всегда дотягивается клиентом отдельным
REST/WebSocket-запросом: номер телефона, платёжные реквизиты, точный адрес,
любые токены/секреты, персональные данные другого участника поездки
(координаты водителя/пассажира, имя, машина).

## `PushNotificationPayloadSchema` vs `PushDataPayloadSchema`

Специально два разных типа: `PushNotificationPayloadSchema` — полный
манифест уведомления (включает `title`/`body`) для серверной записи и
инбокса; `PushDataPayloadSchema` — то, что реально едет в `data`-блоке
нативного push-сообщения. `title`/`body` в push-уведомлении передаются через
верхнеуровневые поля `notification.title`/`notification.body` сообщения FCM
(см. `firebase-push.provider.ts`), не через `data` — то есть текст
уведомления не обязан (и не должен) дублироваться в data-payload.

## `NotificationPreviewMode` — что показывается на заблокированном экране

Три значения (`NotificationPreviewMode`, хранится в
`NotificationPrivacySetting.previewMode`, по умолчанию `GENERIC`):

- **`FULL`** — полный заголовок и текст уведомления показываются как есть
  (в том числе на заблокированном экране).
- **`GENERIC`** (по умолчанию) — рекомендуемый режим: на клиенте вместо
  реального текста показывается нейтральная подпись («У вас новое
  уведомление»), полный текст виден только после разблокировки/открытия
  приложения.
- **`HIDDEN`** — уведомление не показывает вообще никакого текста на
  заблокированном экране, только факт наличия push (иконка приложения).

**Важно (честно про текущий охват):** backend хранит и отдаёт
`previewMode` через `GET /notifications/preferences`, но фактическое
управление видимостью на заблокированном экране — это системная настройка
конкретной ОС (Android `Notification.VISIBILITY_PUBLIC/PRIVATE/SECRET`,
iOS `UNNotificationContentExtension`/системные Notification Settings),
которую приложение может задать по умолчанию для канала/категории, но не
может обойти пользовательские настройки самой ОС. driver-android
(`PushNotificationChannel`) создаёт каналы без явного
`setLockscreenVisibility` — на текущем этапе это задел, реализация полного
маппинга `previewMode → android channel visibility` на каждый канал
осталась вне рамок этой задачи (см. известные пробелы в финальном отчёте).
passenger-mobile также пока не читает `previewMode` для локальной настройки
`expo-notifications` — значение сохраняется и отдаётся API, но клиенты его
ещё не применяют к системным каналам/категориям. Это явный, осознанно
отложенный пробел, а не забытая часть.

## `NotificationPreference` — что нельзя выключить

`NotificationPreferenceService.ALWAYS_ENABLED_CATEGORIES = {SECURITY,
ACTIVE_TRIP}`. Даже если клиент явно пришлёт `pushEnabled: false` для этих
категорий в `PUT /notifications/preferences`, сервер молча приравнивает
значение к `true` — и на чтении (`getPreferences`), и на записи
(`updatePreferences`), и в самой точке принятия решения перед отправкой
(`isPushEnabled`, используется `NotificationOutboxWorker`). Обоснование:
`SECURITY` — уведомления о завершении сессии (потенциальный несанкционированный
доступ), `ACTIVE_TRIP` — статус уже идущей поездки, критичной для
безопасности и логистики прямо сейчас. Единственный по-настоящему
действующий выключатель для этих категорий — системное разрешение ОС на
уведомления в целом (`notificationsPermission` на `DevicePushToken`), которое
приложение не может обойти.

## Метки метрик — инвариант приватности

Все `this.metrics.increment/setGauge` вызовы в модуле notifications
используют лейблы только из закрытого набора: `provider`, `application`,
`platform`, `type` (`NotificationType`, не произвольная строка). Ни в одном
месте модуля userId, номер телефона или сам push-токен не используются как
значение метрики/лейбла — иначе кардинальность и приватность метрик были бы
скомпрометированы (Prometheus-подобные метрики предполагаются публично
читаемыми операционной командой, а не только владельцем данных). См.
`monitoring.md` за полным списком меток на каждую метрику.

## Логи

`PushTokenCryptoService` и провайдеры (`FirebasePushProvider` и т.д.) не
логируют сырой токен ни при успехе, ни при ошибке — `Logger`-вызовы в
`firebase-push.provider.ts` включают только `providerType`/код ошибки/
идентификатор уведомления, не сам токен и не тело push-сообщения целиком.
