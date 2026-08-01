# Регистрация и жизненный цикл `DevicePushToken`

## Модель

Каждая строка `DevicePushToken` — это один зарегистрированный
push-токен одного устройства для одного пользователя и одного приложения
(`PASSENGER`/`DRIVER`). Ключевые поля: `application`, `platform`
(`ANDROID`/`IOS`), `provider` (`DEVELOPMENT`/`STAGING`/`FCM`/`APNS` —
вычисляется сервером, см. ниже), `environment`, `status`
(`ACTIVE`/`INVALID`/`REVOKED`/`EXPIRED`), `tokenEncrypted`, `tokenHash`,
`deviceSessionId` (привязка к сессии из auth-модуля), `lastRegisteredAt`,
`lastUsedAt`.

## Шифрование и хранение (`PushTokenCryptoService`)

`apps/api/src/notifications/infrastructure/push-token-crypto.service.ts` —
единственное место, где сырой push-токен шифруется/расшифровывается/хешируется:

- **`encrypt`/`decrypt`** — AES-256-GCM, ключ — `PUSH_TOKEN_ENCRYPTION_KEY`
  (32 байта, base64). Обратимо, потому что отправка пуша требует реального
  токена.
- **`hash`** — HMAC-SHA256 с отдельным секретом `PUSH_TOKEN_HASH_SECRET`.
  Необратимо; `DevicePushToken.tokenHash` — то, что реально используется для
  поиска/уникальности (`register()` находит существующую строку по хешу, а
  не расшифровывая все токены пользователя). Сырой токен никогда не
  используется как ключ БД и никогда не появляется в логах модуля.

`PublicDevicePushToken` (DTO, отдаваемый по HTTP) не содержит ни
зашифрованного токена, ни хеша, ни `rawToken` — только `id`,
`application`/`platform`/`provider`/`status`, версии приложения/ОС, локаль,
временные метки.

## Выбор provider — всегда на сервере

`DeviceTokenService.registerDevice()` вычисляет `provider` через
`determinePushProviderType(environment, platform, configuredProvider)`
(`providers/push-provider-selection.ts`) на основе `app.appEnvironment` и
`PUSH_PROVIDER` — клиент передаёт только `platform`, само значение
`provider`/`environment` из тела запроса никогда не принимается. Это не даёт
клиенту (или атакующему с перехваченным телом запроса) заставить сервер
считать staging-токен боевым или наоборот.

## Эндпоинты (`notifications/devices`, `AccessTokenGuard` + `Roles('PASSENGER','DRIVER')`)

| Метод | Путь | Действие |
|---|---|---|
| `POST` | `/notifications/devices` | Регистрация нового токена устройства |
| `POST` | `/notifications/devices/refresh` | Обновление токена (то же тело — под капотом идентично `register`, см. ниже) |
| `DELETE` | `/notifications/devices/:id` | Отзыв токена (например, при выходе из аккаунта) |
| `GET` | `/notifications/devices` | Список активных устройств текущего пользователя |

`application` в теле запроса не передаётся вообще — он однозначно выводится
из роли аутентифицированного пользователя (`roleToPushApplication`), поэтому
DRIVER-аккаунт физически не может зарегистрировать PASSENGER-токен и наоборот.

`refresh` реализован как псевдоним `registerDevice` — `DeviceTokenService.refreshDevice`
буквально вызывает тот же код: `DevicePushTokenRepository.register()` уже
идемпотентен относительно (userId, deviceId, application) — повторная
регистрация с тем же токеном не создаёт вторую строку, а с новым —
заменяет предыдущую активную запись для того же устройства. Поэтому клиенты
(и driver-android, и passenger-mobile) всегда вызывают один и тот же путь
регистрации, отдельной ветки "это refresh, а не register" на клиенте нет.

`revoke` проверяет, что токен принадлежит вызывающему пользователю
(`findByIdForUser`), иначе `404 DEVICE_TOKEN_NOT_FOUND` — нельзя отозвать
чужой токен по id.

## Rate limiting (`DeviceTokenRateLimitService`)

Fail-closed по образцу `AuthRateLimitService`: лимит
`PUSH_RATE_LIMIT_REGISTER_MAX_PER_USER_HOUR` (по умолчанию 20) регистраций в
час на пользователя, ключ в Redis `ratelimit:devicetoken:register:user:{userId}`.
Если Redis недоступен — регистрация отклоняется (`503
RATE_LIMIT_STORE_UNAVAILABLE`), а не молча пропускается без лимита. При
первом превышении лимита (`count === limit + 1`) один раз пишется
`SecurityEvent` типа `PUSH_TOKEN_MASS_REGISTRATION_SUSPECTED` — не на каждую
последующую заблокированную попытку, аналогично тому, как `OtpService`
пишет security-событие один раз в момент блокировки.

## Валидация формата токена

`DeviceTokenService.validateTokenFormat` отклоняет токены короче 32 или
длиннее 4096 символов и токены, содержащие пробельные символы —
`400 INVALID_PUSH_TOKEN_FORMAT`. Это защита от мусора на входе, а не
проверка того, что токен реально валиден у FCM/APNs (это узнаётся только
при реальной отправке — см. `retries.md`, поле `TOKEN_INVALID`).

## Как токен становится `INVALID`

`NotificationOutboxWorker` при отправке помечает `NotificationDelivery`
статусом `TOKEN_INVALID`, когда провайдер вернул один из кодов из
`PERMANENT_TOKEN_ERROR_CODES` (`FirebasePushProvider`:
`messaging/invalid-registration-token`,
`messaging/registration-token-not-registered`,
`messaging/invalid-argument`) — в этот момент соответствующий
`DevicePushToken.status` тоже переводится в `INVALID`, и токен больше не
участвует в `listActiveTargetsForUser`. Для staging это можно вызвать вручную
через `POST /admin/staging/push/tokens/:tokenId/simulate-invalid` (см.
`monitoring.md`).
