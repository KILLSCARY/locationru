# Мониторинг push-уведомлений

## Метрики (`GET /metrics`, Prometheus text format, `MetricsService`)

Ровно 12 метрик, все с лейблами только из закрытого набора
(`provider`/`application`/`platform`/`type` — см. `privacy.md`, «Метки
метрик — инвариант приватности», никогда userId/телефон/токен):

| Метрика                           | Тип     | Лейблы                                                  | Где инкрементируется/выставляется                                                                             |
| --------------------------------- | ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `notifications_created_total`     | counter | `type`, `application`                                   | `NotificationOutboxWorker.upsertNotification` — при создании строки `Notification`                            |
| `notifications_queued_total`      | counter | `type`, `application`                                   | `NotificationOutboxService.enqueue` — при постановке нового события в outbox                                  |
| `push_send_attempts_total`        | counter | `provider`, `application`, `platform`, `type`, `result` | `NotificationOutboxWorker.sendEvent` — на каждый результат отправки на каждый токен                           |
| `push_provider_accepted_total`    | counter | `provider`, `application`                               | там же — когда провайдер вернул `ACCEPTED`                                                                    |
| `push_invalid_token_total`        | counter | `provider`, `application`                               | там же — когда провайдер вернул перманентно невалидный токен                                                  |
| `push_retry_total`                | counter | `type`, `application`                                   | `NotificationOutboxWorker.retryOrDeadLetter` — при планировании очередной попытки                             |
| `push_dead_letter_total`          | counter | `type`, `application`                                   | там же — при исчерпании `maxAttempts`                                                                         |
| `push_failed_total`               | counter | `provider`, `application`, `type`                       | `sendEvent` — на временный или перманентный сбой отправки                                                     |
| `push_provider_latency_ms`        | gauge   | `provider`                                              | `sendEvent` — время последнего вызова `sendToDevices` в мс                                                    |
| `push_opened_total`               | counter | `application`, `type`                                   | `NotificationInboxService` — когда клиент подтверждает открытие push (`POST /notifications/inbox/:id/opened`) |
| `active_push_tokens`              | gauge   | `application`, `platform`                               | `NotificationOutboxWorker.refreshGauges` — количество `DevicePushToken` со статусом `ACTIVE`                  |
| `notification_outbox_lag_seconds` | gauge   | —                                                       | там же — возраст самой старой `PENDING` строки outbox на момент опроса                                        |

`push_send_attempts_total`/`push_failed_total` дополнительно несут лейбл
результата/причины сбоя (`result`) — точное значение см. в
`notification-outbox.worker.ts` рядом с каждым вызовом
`this.metrics.increment(...)`.

## Admin-эндпоинты (`SUPER_ADMIN`-only, кроме проверки статуса)

Раздел «Push notifications» в `admin-web` использует три эндпоинта
`AdminController`/`AdminService` (`apps/api/src/admin`):

| Метод  | Путь                                              | Что возвращает                                                                                                                                                                                                   |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/admin/notifications/push-stats`                 | Снимок на текущий момент: `outboxByStatus` (счётчики по каждому статусу outbox), `notificationsByStatus`, `activeTokens` (по application/platform) — только агрегаты, никогда номер телефона/токен/сырой payload |
| `GET`  | `/admin/notifications/dead-letter`                | Постраничный список `DEAD_LETTER`-событий: `id`, `type`, `application`, `userId`, `attempts`/`maxAttempts`, `lastError`, `createdAt`/`processedAt`                                                               |
| `POST` | `/admin/notifications/dead-letter/:eventId/retry` | Сбрасывает `attempts` в 0, переводит строку в `PENDING`, `availableAt: now` — воркер подберёт на следующем цикле опроса. `404 PUSH_EVENT_NOT_RETRYABLE`, если событие не найдено или не в `DEAD_LETTER`          |

`getPushStats`/`listDeadLetterPush` — это снимок для человека
(«взглянуть на админку прямо сейчас»); `/metrics` — временной ряд для
Prometheus/Grafana. Оба читают одни и те же таблицы, но не подменяют друг
друга: снимок не хранит историю, метрики не дают постраничный список
конкретных событий с `lastError`.

### Аудит ручного ретрая

Каждый вызов `POST /admin/notifications/dead-letter/:eventId/retry`
записывает строку `AdminAuditLog` (`action: 'PUSH_DEAD_LETTER_RETRIED'`,
`targetType: 'NotificationOutboxEvent'`, `targetId: eventId`,
`adminId` — кто именно нажал) — видно в `GET /admin/audit`. Ни один другой
push-related admin-эндпоинт (`push-stats`, список dead-letter) не мутирует
состояние и поэтому не аудируется.

## Staging-инструменты (`SUPER_ADMIN`-only, `/admin/staging/push/*`)

Отдельно от прод-мониторинга — набор эндпоинтов только для
staging-окружения (`staging-tools.controller.ts`, весь контроллер помечен
`@ApiExcludeController()`, не попадает в публичный Swagger):

| Метод  | Путь                                                   | Действие                                                                                                                                                  |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/admin/staging/push/test-send`                        | Реальный прогон через полный outbox-пайплайн (`userId`+`application`) — но всегда через `DevelopmentPushProvider` (см. ниже), никогда в реальный FCM/APNs |
| `GET`  | `/admin/staging/push/tokens/:userId`                   | Список токенов конкретного пользователя (для отладки — кому реально должен был уйти push)                                                                 |
| `POST` | `/admin/staging/push/tokens/:tokenId/simulate-invalid` | Принудительно помечает токен `INVALID` — проверить путь "провайдер сказал, что токен мёртв" без реального отказа FCM                                      |

`test-send` **намеренно** не бьёт в реальный Firebase — даже в
staging-окружении с настроенным `PUSH_PROVIDER=fcm`, чтобы прогон
`pnpm staging:test:push` в CI/на staging-сервере никогда не отправлял
реальные push на реальные устройства случайно (соответствует пункту
задачи «никаких реальных push из CI»).

## Алерты (примеры PromQL — Prometheus/Alertmanager в этой инфраструктуре

## пока не развёрнуты, см. `docs/runbooks/otp-incident-response.md` за тем

## же дисклеймером)

```promql
# Растущий бэклог outbox — воркер не успевает или упал
notification_outbox_lag_seconds > 300

# Всплеск dead-letter — систематическая проблема с провайдером/токенами,
# не единичный сбой
increase(push_dead_letter_total[15m]) > 20

# Резкое падение доли принятых провайдером сообщений
sum(rate(push_provider_accepted_total[5m]))
  /
sum(rate(push_send_attempts_total[5m])) < 0.5

# Задержка провайдера подскочила — вероятный частичный отказ FCM/APNs
push_provider_latency_ms > 5000
```

## Известные пробелы (честно, не «доделать позже» тихо)

- Метрики не разбиты по `NotificationCategory` — только по `type` (24
  значения) и `provider`/`application`/`platform`. Кардинальность `type` уже
  на грани разумной для label — добавление ещё и `category` не дало бы
  значимой новой информации (category выводится из type однозначно).
- Нет отдельной метрики на латентность самого outbox-воркера
  (время от `createdAt` до `processedAt`) — только текущий `lag`
  (возраст самой старой `PENDING`-строки). Гистограмма end-to-end
  задержки доставки не реализована.
- `listDeadLetterPush` не фильтруется по `type`/`application` — только
  постраничный список всех dead-letter событий целиком; для
  большого объёма потребуется добавить фильтры (не было необходимости
  при текущем ожидаемом объёме).
