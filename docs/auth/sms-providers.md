# SMS-провайдеры

## Интерфейс

`apps/api/src/auth/providers/sms-provider.interface.ts` определяет
`SmsProvider` (5 методов) и токен DI `SMS_PROVIDER`. Выбор конкретной
реализации происходит только в
`apps/api/src/auth/providers/sms-provider.factory.ts` — это
единственное место в кодовой базе, где по имени называется
`DevelopmentSmsProvider`, `StagingSmsProvider` или `SmsRuProvider`.
`OtpService`/`AuthService`/`AuthController` работают только с
интерфейсом.

Переключение — переменная `SMS_PROVIDER`:

| Значение      | Где разрешено                          | Что делает                                                                                                        |
| ------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `development` | только `APP_ENV=development`           | пишет код и сообщение в лог, никуда не отправляет                                                                 |
| `staging`     | `APP_ENV` ∈ {development, staging}     | кладёт код в Redis (`GET /api/v1/admin/staging/otp/:phone`, только SUPER_ADMIN, аудируется), никуда не отправляет |
| `sms-ru`      | любой APP_ENV, обязателен в production | реальная отправка через SMS.RU HTTP API                                                                           |

Правило enforced в двух местах одновременно (defence in depth):
`env.validation.ts` (Joi `.when('APP_ENV', ...)`) и
`sms-provider.factory.ts` (throw при несовпадении).

## DevelopmentSmsProvider / StagingSmsProvider

Обе реализации **сохранены без изменений в поведении** (только
обновлены под новый интерфейс из 5 методов вместо старого
`sendCode(phone, code)`). `StagingSmsProvider` по-прежнему кладёт
plaintext-код в Redis по ключу `stagingOtpLookupKey(phone)` с TTL из
`otp.ttlSeconds` — это админский инструмент для тестирования на staging
без реальной SMS-отправки, ничего в этой логике не менялось.

## SmsRuProvider

`apps/api/src/auth/providers/sms-ru.provider.ts` — единственный
реальный адаптер. HTTP-транспорт: GET-запросы с query-параметрами (у
SMS.RU нет JSON body для `/sms/send`/`/sms/status`/`/my/balance`).

- **Отправка** (`sendVerificationCode`/`sendTransactionalMessage`) —
  без ретраев: повторная отправка уже возможно доставленной SMS —
  недопустимый риск задвоения.
- **Статус** (`getDeliveryStatus`) и **баланс** (`getBalance`, только
  для админки) — идемпотентные GET, до `SMS_RU_MAX_RETRIES` попыток с
  экспоненциальной задержкой (100мс, 200мс, ...).
- **Circuit breaker** — переиспользован `CircuitBreaker` из
  `apps/api/src/maps/providers/circuit-breaker.ts` (тот же паттерн, что
  уже применялся для Maps-провайдеров): после
  `SMS_RU_CIRCUIT_FAILURE_THRESHOLD` подряд неудач запросы
  «замыкаются» на `SMS_RU_CIRCUIT_OPEN_MS`, не долбя недоступный
  SMS.RU.
- **API-ключ (`api_id`) никогда не попадает** в лог, в брошенную
  ошибку или в ответ клиенту. Он есть только в query string самого
  HTTP-запроса, который строит `SmsRuProvider` сам. Ошибки сети
  логируются без текста самой ошибки (`kind: 'network_error'`), чтобы
  случайно не залогировать URL с ключом внутри сообщения об ошибке
  `fetch`.

### Нормализация статусов

`apps/api/src/auth/providers/sms-ru.status.ts` — таблица кодов SMS.RU
(100–108) → `SmsDeliveryStatus` (`QUEUED`/`SENT`/`DELIVERED`/`FAILED`/
`EXPIRED`/`REJECTED`/`UNKNOWN`). **Важно:** таблица составлена по
опубликованной документации SMS.RU и не проверена вживую against
реальный аккаунт (см. ограничения в финальном отчёте по Задаче 27) —
перед продакшн-запуском обязательно прогнать
`pnpm staging:test:sms` и свериться с реальными кодами в личном
кабинете, при расхождении — поправить `SMS_RU_STATUS_CODE_MAP`.

### Баланс — только для админки

`SmsRuProvider.getBalance()` не является частью интерфейса
`SmsProvider` — это дополнительный публичный метод, используемый только
`AdminAuthService.getSmsBalance()` (`GET /api/v1/admin/auth/sms-balance`,
роли `ADMIN`/`SUPER_ADMIN`). Health check (`healthCheck()`) дергает тот
же `/my/balance`, но возвращает только `{healthy, detail?}` — само
значение баланса наружу через health check не уходит.

## SmsTemplateService

`apps/api/src/auth/sms-template.service.ts` — единственное место, где
собирается текст SMS. Клиент никогда не может передать свободный текст:
`renderVerificationCode(purpose, code, locale)` принимает только code
(строка цифр) и enum `purpose`/`locale`. Шаблон для `LOGIN`:

> Код входа в Resilient Taxi: {code}. Никому его не сообщайте.

Версионирование через `templateVersion` в возвращаемом объекте (сейчас
у всех шаблонов версия 1). `locale` — задел на будущее, реализован
только `ru`.
