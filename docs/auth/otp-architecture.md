# Архитектура OTP-авторизации

## Разделение ответственности

- **`OtpService`** (`apps/api/src/auth/otp.service.ts`) — единственный
  владелец домена OTP: генерация кода, хеширование, хранение состояния,
  срок жизни, счётчик попыток, прогрессивный resend-таймаут, блокировка,
  одноразовое использование. SMS-провайдер, который ему передан через DI,
  отвечает только за доставку — он не знает про Redis, Postgres,
  rate-limit или блокировки.
- **`SmsProvider`** (`apps/api/src/auth/providers/sms-provider.interface.ts`)
  — интерфейс с 5 методами (`sendVerificationCode`,
  `sendTransactionalMessage`, `getDeliveryStatus`, `handleStatusWebhook`,
  `healthCheck`) и токеном `SMS_PROVIDER`. Ни `AuthService`, ни
  `OtpService` никогда не импортируют конкретный класс — единственное
  место, где это происходит, это `sms-provider.factory.ts`.
- **`AuthService`** (`apps/api/src/auth/auth.service.ts`) — сохранённая
  без переделки JWT/refresh-архитектура (scrypt-хеш refresh-секрета,
  access-токен через `@nestjs/jwt`), поверх которой добавлены вызовы
  `OtpService`/`AuthRateLimitService` и управление `DeviceSession`
  (ротация, отзыв по семье токенов, множественные сессии).

## Redis vs Postgres

Redis хранит **единственное активное состояние** OTP-запроса на пару
(`purpose`, `phoneHash`) — то, с чем реально сравнивается введённый код:
`codeHash`, `attemptsUsed`, `resendCount`, `resendAvailableAtMs`,
`expiresAtMs`. Именно поэтому `verifyCode` читает Redis, а не Postgres.

Postgres (`OtpRequest`) — durable история без самого кода: `codeHash`
(не сам код), `status`, `attemptsUsed`, `providerMessageId`,
`providerStatus`, временные метки. Используется для аналитики, аудита и
сопоставления с вебхуком SMS.RU по `providerMessageId`.

Если Redis недоступен, `OtpService.requireRedis()` кидает `503
OTP_STORE_UNAVAILABLE` — **никогда** нет отката на in-memory состояние
(оно не переживёт рестарт и не будет видно другой реплике).

## Генерация кода

`OtpService.generateCode()` — `crypto.randomInt`, длина конфигурируется
(`OTP_SMS_CODE_LENGTH`, по умолчанию 6). Отклоняются «слабые»
последовательности: все цифры одинаковые (`000000`, `999999`) и строго
монотонные по возрастанию/убыванию (`123456`, `654321`) — до 20 попыток
перегенерации, затем ошибка (это отражает конфигурационную ошибку типа
`OTP_SMS_CODE_LENGTH=1`, а не штатный кейс).

Единственное исключение — фиксированный код `000000`, доступный **только**
если одновременно `APP_ENV=development` и `ENABLE_DEVELOPMENT_OTP=true`
(Joi жёстко запрещает `true` для этого флага в staging/production — см.
`env.validation.ts`). Он специально проходит без проверки на «слабость»,
чтобы дев-цикл и e2e-тесты могли предсказуемо вводить один и тот же код.

Код хешируется через HMAC-SHA256 с секретом `AUTH_OTP_HASH_SECRET`
(тот же секрет и паттерн, что использовался в старой реализации до
Задачи 27) и сравнивается через `timingSafeEqual` — сам код никогда не
попадает в лог, БД или ответ клиенту.

## Purpose / Status / Channel

`OtpPurpose`: `LOGIN`, `DRIVER_REGISTRATION`, `PHONE_CHANGE`,
`SENSITIVE_ACTION` — модель поддерживает все четыре, но в этой задаче к
HTTP-эндпоинту (`POST /api/v1/auth/request-code` и остальные) подключён
только `LOGIN`. Остальные три существуют в схеме и в
`SmsTemplateService`, но живого пути вызова у них нет — это осознанное
ограничение объёма задачи, а не забытая доработка.

`OtpStatus`: `CREATED → SENDING/SENT/DELIVERED/FAILED → VERIFIED/EXPIRED
/BLOCKED → CONSUMED`. `CONSUMED` проставляется `OtpService.consume()`,
который вызывает `AuthService.verifyCode()` уже после того, как сессия
реально выдана — так что `OtpRequest` не помечается «использованным»,
если создание сессии упадёт на середине.

`VerificationChannel`: `SMS`, `FLASH_CALL`, `INCOMING_CALL`, `STAGING`.
Реально работает только `SMS` (через SMS.RU или dev-провайдер).
`FLASH_CALL`/`INCOMING_CALL` — заготовка на будущее (см.
`AuthService.getChannels()` и `GET /api/v1/auth/channels`, который
честно возвращает `available: false` для них). `STAGING` — не настоящий
транспорт, а маркер, что `StagingSmsProvider` ничего не отправил вовне
и код доступен только через `GET /api/v1/admin/staging/otp/:phone`.

## Rate limiting и блокировки

См. `docs/auth/rate-limiting-and-blocking.md`.

## SMS.RU

См. `docs/auth/sms-providers.md` и `docs/auth/sms-ru-setup.md`.
