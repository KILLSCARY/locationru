# Outbox: состояния, ретраи, dead-letter, схлопывание

Реализация: `apps/api/src/notifications/notification-outbox.service.ts`
(запись/схлопывание при постановке в очередь) и
`notification-outbox.worker.ts` (опрос/захват/отправка/ретрай/dead-letter).

## Состояния `NotificationOutboxEvent`

`PENDING` → `PROCESSING` (захвачен воркером) → `DELIVERED` | обратно
`PENDING` (ретрай) | `DEAD_LETTER` (исчерпаны попытки) | `CANCELLED`
(вытеснен через SUPERSEDE) | `EXPIRED` (истёк TTL до отправки).

## Поллинг и захват (at-least-once, без `SELECT ... FOR UPDATE`)

`processPending()` вызывается по таймеру (`push.outboxPollIntervalMs`,
`.env`: `PUSH_OUTBOX_POLL_INTERVAL_MS`, по умолчанию 1000 мс; отключено в
`environment: 'test'`, чтобы юнит/e2e-тесты не гонялись с фоновым таймером).
Захват — тот же паттерн, что и у `RealtimeOutboxService`: условный
`updateMany({ where: { id, status: PENDING }, data: { status:
PROCESSING, attempts: increment(1), availableAt: now + 30s } })`; если
`claimed.count !== 1` — событие уже забрал другой воркер, пропускаем. Строка,
застрявшая в `PROCESSING` дольше `CLAIM_VISIBILITY_MS` (30 секунд) —
считается брошенной упавшим воркером и возвращается в `PENDING` в начале
следующего `processPending()`. Батч — 20 событий за проход
(`BATCH_SIZE`), сортировка по `createdAt` (FIFO).

Именно захват через условный `updateMany` (а не долгую транзакцию с
блокировкой строки) даёт **at-least-once, не exactly-once** доставку на
уровне БД — отсюда требование идемпотентности на следующих уровнях
(`deduplicationKey` на входе, `NotificationDelivery` на выходе).

## TTL — истечение без ошибки

Если `event.expiresAt` уже в прошлом на момент обработки — событие переходит
в `EXPIRED` без единой попытки отправки и без записи в `push_retry_total`/
`push_failed_total`: предложение по заказу, на которое уже физически никто
не успел бы отреагировать, — это не сбой, а нормальный исход (см. `types.md`
за TTL-бакетами `NEW_ORDER`/`ACTIVE_TRIP`/`LONG`).

## Проверка предпочтений — до отправки, не после

Перед вызовом провайдера воркер вызывает
`NotificationPreferenceService.isPushEnabled(userId, application,
category)`. Если категория выключена — `Notification` всё равно создаётся
(видна в инбоксе), но получает статус `CANCELLED`, `NotificationDelivery` не
создаётся вовсе, а outbox-событие сразу помечается `DELIVERED` (в смысле
«обработано», а не «отправлен push»). `SECURITY`/`ACTIVE_TRIP` здесь всегда
возвращают `true` — см. `privacy.md`.

## Экспоненциальный backoff + jitter (`retryOrDeadLetter`)

Точная формула из `notification-outbox.worker.ts`:

```ts
if (event.attempts >= event.maxAttempts) {
  // -> DEAD_LETTER, push_dead_letter_total++
}

const backoffSeconds = Math.min(
  maxDelaySeconds,                                    // push.maxRetryDelaySeconds
  initialDelaySeconds * 2 ** (event.attempts - 1),     // push.initialRetryDelaySeconds
);
const jitteredSeconds = backoffSeconds * (0.5 + Math.random() * 0.5); // 50–150%
availableAt = now + jitteredSeconds * 1000;
// -> PENDING, push_retry_total++
```

Значения по умолчанию (`.env.example`): `PUSH_INITIAL_RETRY_DELAY_SECONDS=5`,
`PUSH_MAX_RETRY_DELAY_SECONDS=900` (15 минут), `PUSH_MAX_ATTEMPTS=5`.
Прогрессия задержек (без учёта джиттера, `attempts` = номер уже сделанной
попытки): 5с → 10с → 20с → 40с → (5-я попытка исчерпывает `maxAttempts`,
дальше `DEAD_LETTER`). Джиттер — множитель `0.5..1.5`, то есть реальная
задержка перед следующей попыткой — от половины до полутора расчётного
значения; это стандартный приём против «грозы ретраев» (thundering herd),
когда много событий, поставленных в очередь почти одновременно (например,
после кратковременного отказа FCM), не бьют в провайдер синхронной волной.

`lastError` — обрезанная до 512 символов причина последней неудачи
(текст исключения либо один из специальных `outcome`, например `'no active
device tokens for this user'`) — видна в `GET
/admin/notifications/dead-letter` (см. `monitoring.md`).

## `NotificationDelivery` — статус на уровне (уведомление × токен)

Одна строка на пару (Notification, DevicePushToken), не на попытку —
переотправка обновляет ту же строку. Статус выводится из
`SendOutcomeStatus`, который возвращает `PushProvider`:

| `SendOutcomeStatus` | `NotificationDeliveryStatus` |
|---|---|
| `ACCEPTED` | `PROVIDER_ACCEPTED` |
| `TOKEN_INVALID` | `TOKEN_INVALID` |
| `FAILED_TEMPORARY` | `FAILED_TEMPORARY` |
| `FAILED_PERMANENT` | `FAILED_PERMANENT` |

Событие в целом (`sendEvent()`) считается `DELIVERED`, если хотя бы одна
доставка (на любой из активных токенов пользователя) получила `ACCEPTED` —
пользователь с несколькими устройствами получает push хотя бы на одно из
них, даже если другое временно недоступно.

## Collapse / дедупликация — три стратегии на входе в очередь

Применяется в `NotificationOutboxService.enqueue()`, **до** создания
строки outbox (то есть ретраи/доставка их вообще не касаются — это
политика постановки в очередь, не отправки):

- **`deduplicationKey`** (SHA-256 от `userId:type:entityId:idempotencyKey`)
  — если строка с таким ключом уже существует, `enqueue()` — no-op. Это
  защита от повторной обработки одного и того же доменного события
  (at-least-once издатель) — гарантирует «ровно одно уведомление на одно
  реальное событие», а не «ровно одна попытка отправки» (это обеспечивается
  ретраями выше).
- **`SUPERSEDE`** — перед вставкой новой строки все ещё `PENDING` строки с
  тем же `collapseKey` (SHA-256 от `userId:type:entityId`, без
  event-специфичного id вроде `bidId`) переводятся в `CANCELLED`. Например:
  статус поездки сменился дважды подряд быстрее, чем ушёл первый push —
  первый (устаревший) отменяется, отправляется только второй.
- **`COLLAPSE_COUNT`** — если уже есть `PENDING` строка того же
  `collapseKey`, новое событие не создаёт вторую строку, а инкрементирует
  `payload.count` существующей и **перерендеривает** заголовок/текст через
  `NotificationTemplateService.render(type, { count })` — иначе текст
  остался бы «Получено новое предложение» при реально нескольких. Как
  только предыдущая строка перестаёт быть `PENDING` (уже отправлена/dead
  letter), следующее событие того же `collapseKey` начинает новую цепочку
  счётчика с 1.
- **`NONE`** — всегда независимая строка (например, выплата водителю —
  каждая должна дойти отдельно, схлопывание тут было бы багом, а не
  оптимизацией).

Присвоение стратегии каждому из 24 типов — в `types.md`.

## Ручной admin-ретрай из dead-letter

`POST /admin/notifications/dead-letter/:eventId/retry`
(`AdminController`/`AdminService`, только `SUPER_ADMIN`, см. `monitoring.md`)
— переводит указанную `DEAD_LETTER`-строку обратно в `PENDING` со сброшенным
счётчиком попыток, чтобы воркер подобрал её на следующем цикле опроса.
Несуществующий `eventId` — `404`. Каждый вызов — audit-логируется (см.
`monitoring.md`, «Аудит»).
