# Архитектура staging-окружения

Цель staging: постоянно доступное тестовое окружение с полным сценарием
поездки через реальные сетевые подключения — без настоящих платежей,
production SMS и production-секретов.

## AppEnvironment вместо NODE_ENV

Раньше все проверки безопасности («не выдавать dev-провайдеров вне разработки»
и т.п.) были завязаны на `NODE_ENV`. Это смешивало две разные вещи:
`NODE_ENV` — забота Node/npm-экосистемы (dev-предупреждения, отсечение
dev-зависимостей, `NODE_ENV=test` для тестового раннера), а
security-ветвление — отдельная ось, которая теперь называется `APP_ENV`.

Пакет `packages/config` (`src/environment.ts`) определяет:

```ts
const AppEnvironment = { DEVELOPMENT, TEST, STAGING, PRODUCTION };
```

`APP_ENV` по умолчанию равен значению `NODE_ENV` (через `Joi.ref('NODE_ENV')`
в `apps/api/src/config/env.validation.ts`), поэтому все существующие
окружения (dev, CI-тесты, production) продолжают работать без изменений —
явно указывать `APP_ENV` нужно только для staging.

Все провайдеры (SMS, платежи, карты) читают `app.appEnvironment`, а не
`app.environment` (это alias для `NODE_ENV`, который сохранён отдельно —
им по-прежнему пользуется `RealtimeOutboxService` для отключения
poll-таймера под `NODE_ENV=test`, чтобы не мешать тестовому раннеру
Jest — это единственное оставшееся место, сознательно завязанное на
`NODE_ENV`, а не на `APP_ENV`).

## Топология (docker-compose.staging.yml)

```
                         ┌──────────────┐
                         │    Caddy     │  :80/:443 — единственный
                         │ (edge network)│  сервис с публичными портами
                         └──────┬───────┘
                    ┌───────────┴───────────┐
              ┌─────▼─────┐           ┌─────▼──────┐
              │    api    │           │ admin-web  │
              │(data+edge)│           │   (edge)   │
              └─────┬─────┘
        ┌────────────┼────────────┐
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
   │ postgres │  │  redis  │  │  minio  │      сеть `data` — без
   │(PostGIS) │  │         │  │  (S3)   │      публичных портов
   └─────────┘  └─────────┘  └─────────┘
```

Postgres, Redis и MinIO находятся только в сети `data`, к которой Caddy не
подключён — снаружи они физически недостижимы, даже если кто-то забудет
закрыть порт файрволом на хосте. `api` состоит в обеих сетях (`data` —
чтобы говорить с БД/Redis/MinIO, `edge` — чтобы Caddy мог до него
достучаться). `migrate` — тоже в обеих сетях: помимо миграций он же
служит раннером для `pnpm staging:seed` и `pnpm staging:smoke`
(`docker compose run --rm migrate <command>`), а smoke-тесту нужен
прямой доступ и к БД/Redis, и к `api`/`admin-web`.

## Провайдеры: staging как третий уровень, не «development в проде»

До этой задачи провайдеры (SMS, платежи, карты) переключались между
`development` (небезопасный, для локальной разработки) и реальным
(`http`/`yandex`). Staging — это НЕ development: architecture теперь
знает три уровня:

- `development` — запрещён вне `development`/`test` (бросает исключение
  при старте, если `APP_ENV` иное).
- `staging` — запрещён в `production`, но безопаснее `development`
  (не логирует секреты, использует реальную HMAC-подпись вебхуков и т.д.).
- `http`/`yandex` — настоящая интеграция.

### StagingSmsProvider

Код не возвращается из API и не логируется в обычном виде — хранится в
Redis (`staging:otp-lookup:{phone}`, TTL как у реального OTP) отдельно от
hash, который проверяет реальный `AuthService`. Единственный способ его
увидеть — `GET /api/v1/admin/staging/otp/:phone`, доступный только
SUPER_ADMIN, только при `APP_ENV=staging`, исключён из Swagger и из
production-сборки контроллера целиком (гвард возвращает 404, а не 403 —
снаружи staging этот роут как будто не существует).

### StagingPaymentProvider

Полноценная реализация интерфейса `PaymentProvider` с журналом (Redis,
30 дней) и шестью сценариями (`SUCCESS`, `DECLINED`, `TIMEOUT`,
`DUPLICATE_WEBHOOK`, `REFUND`, `PAYOUT_FAILED`), которые выбираются
только через staging-tools API (никогда клиентом). Вебхуки подписаны
HMAC-SHA256 с `timingSafeEqual`-сравнением — это более строгая проверка,
чем у прежнего `DevelopmentPaymentProvider`.

### MAPS_ALLOW_DEVELOPMENT_IN_STAGING

Карты — единственный провайдер, где staging иногда осознанно использует
`development`-реализацию: настоящий Yandex MapKit ключ стоит денег и
имеет квоты, а smoke-тесту и CI нужен детерминированный, бесплатный
источник геокодинга/маршрутов. Флаг `MAPS_ALLOW_DEVELOPMENT_IN_STAGING`
разрешает это явно (по умолчанию `false` — «настоящий» staging-деплой для
живого QA использует `MAPS_PROVIDER=yandex`).

### ObjectStorageProvider

S3-совместимое хранилище (MinIO в staging) для presigned upload/download
URL. Ключ объекта всегда генерируется сервером (`documents/{ownerId}/{uuid}.
{ext}`), никогда не выводится из имени файла клиента. `NoopObjectStorageProvider`
используется, когда `OBJECT_STORAGE_ENDPOINT` не задан (обычный локальный
dev) — падает громко при попытке использования, а не молча делает вид,
что всё сработало. Антивирусная проверка загруженных файлов сознательно
не реализована — это отдельная будущая задача.

## Наблюдаемость

- **Структурные JSON-логи** (`RequestLoggingInterceptor`): timestamp,
  level, service, environment, requestId, traceId, userId?, tripId?,
  route, method, statusCode, durationMs, errorCode?.
- **requestId/traceId** пробрасываются через `AsyncLocalStorage`
  (`src/observability/request-context.ts`) — единственный известный
  пробел: собственный poll-цикл `RealtimeOutboxService` работает вне
  какого-либо запроса и не наследует контекст (это описано в самом коде
  как осознанный, не устранённый пробел).
- **Маскирование** (`redactSensitiveData`): OTP, токены, Authorization,
  паспортные данные, платёжные секреты — редактируются по имени ключа;
  номера телефонов вида `+7...` маскируются по значению. Как это чуть не
  сломало `requestId` — см. `docs/staging/security.md`.
- **ErrorReporter**: провайдер-агностичный интерфейс
  (`captureException/captureMessage/setUserContext/setTripContext/
clearContext`), `NoopErrorReporter` по умолчанию, `StagingErrorReporter` —
  простой HTTP-JSON адаптер (POST на `ERROR_REPORTER_DSN` либо
  структурный лог, если DSN не задан), без завязки на конкретный SDK.
- **Health-эндпоинты**: `/health` (алиас), `/health/live` (без обращений
  к зависимостям), `/health/ready` (Postgres, Redis, миграции,
  outbox-воркер, object storage, валидность конфигурации — без
  обращения к внешнему картографическому провайдеру на каждый запрос),
  `/health/dependencies` (детальный, admin-only, с таймингами и текстом
  ошибок).

## Известный, не устранённый в этой задаче пробел

`DispatchService.findCandidates()` нигде не вызывается за пределами
собственного unit-теста — в кодовой базе нет ни одного реального
триггера (крон, обработчик события, эндпоинт) для движка подбора
водителей. Это pre-existing пробел, не специфичный для staging — уже
существующий `scripts/simulate-trip.ts` обходит его прямой записью
`DispatchAttempt`/`DispatchAttemptLog` через Prisma, и
`scripts/staging/smoke.sh` делает то же самое. См.
`docs/staging/smoke-tests.md`.
