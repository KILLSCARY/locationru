# Rate limiting, брутфорс-защита и блокировки

## Многоосевой rate limit (`AuthRateLimitService`)

`apps/api/src/auth/auth-rate-limit.service.ts` — отдельный от
`OtpService` слой, проверяется **до** обращения к `OtpService`/SMS.
`OtpService` защищает одну пару (`purpose`, `phone`); этот сервис
защищает эндпоинт в целом от одного IP/устройства, долбящего много
разных номеров, или от общего всплеска нагрузки.

Оси для `request-code`/`resend-code` (все настраиваются через env,
фиксированное окно, счётчик в Redis `INCR` + `EXPIRE` при первом хите):

| Ось        | Ключ                            | Окно  | Лимит (env)                                      |
| ---------- | ------------------------------- | ----- | ------------------------------------------------ |
| Телефон    | `phoneHash` (хеш, не сам номер) | 1 час | `OTP_MAX_SENDS_PER_PHONE_HOUR`                   |
| IP         | HMAC-хеш IP                     | 1 час | `OTP_MAX_SENDS_PER_IP_HOUR`                      |
| Устройство | `deviceId` из тела запроса      | 1 час | `AUTH_RATE_LIMIT_REQUEST_CODE_PER_DEVICE_HOUR`   |
| Глобально  | один общий ключ                 | 1 мин | `AUTH_RATE_LIMIT_REQUEST_CODE_GLOBAL_PER_MINUTE` |

Для `verify-code` — отдельная ось по `requestId` (окно 1 минута,
`AUTH_RATE_LIMIT_VERIFY_CODE_PER_REQUEST_PER_MINUTE`) — защита от
быстрого перебора кода поверх собственного счётчика попыток в
`OtpService`.

Превышение любой оси → единый `429 AUTH_RATE_LIMITED` — без указания,
какая именно ось сработала (чтобы не давать атакующему обратную связь).
Redis недоступен → fail closed, `503 RATE_LIMIT_STORE_UNAVAILABLE` —
та же философия, что у `OtpService.requireRedis()`.

## Брутфорс-защита (`OtpService`)

- Счётчик попыток на конкретный `OtpRequest` (`attemptsUsed` /
  `maxAttempts` из `OTP_MAX_ATTEMPTS`).
- При достижении лимита — временная блокировка (`blockSubject`):
  Redis-ключ `otp:block:LOGIN:{phoneHash}` с TTL `OTP_BLOCK_SECONDS`
  **и** запись в Postgres (`AuthBlock`, тоже с `expiresAt` — никогда не
  бессрочно для автоматической блокировки).
- Единый ответ и время ответа независимо от того, существует ли
  аккаунт с таким номером — `verifyCode` не проверяет существование
  пользователя вообще, эта проверка происходит только в `AuthService`
  **после** успешной верификации кода.
- При достижении лимита попыток пишется `SecurityEvent` с типом
  `OTP_BRUTE_FORCE_SUSPECTED` (метаданные: `purpose`, `requestId`, без
  телефона в открытом виде).
- Прогрессивный resend-таймаут: 1-й повтор — 60 сек, 2-й — 120 сек,
  3-й — 240 сек, 4-я попытка запросить повтор — блокировка
  (`RESEND_ABUSE`).

## Ручная блокировка администратором

`AdminAuthService`/`AdminAuthController`
(`apps/api/src/admin/admin-auth.*`), `POST /api/v1/admin/auth/blocks`
(роль ADMIN/SUPER_ADMIN):

- Блокировка по телефону (нормализуется и хешируется на сервере — сырой
  номер никогда не попадает в `AuthBlock`/`SecurityEvent`) **или** по
  `deviceId`.
- `expiresInSeconds` опционален — если не указан, блокировка бессрочная
  (это единственный способ получить бессрочную блокировку в системе;
  автоматические блокировки всегда с TTL).
- Блокировка по телефону реально enforced: ставится тот же Redis-ключ,
  что использует `OtpService.assertNotBlocked` для `LOGIN` (единственная
  цель с живым HTTP-эндпоинтом в этой задаче) — новые запросы кода для
  этого телефона будут отклонены немедленно.
- Блокировка по устройству enforced в `AuthService.requestCode`/
  `resendCode` через прямой запрос к `AuthBlock` (не через Redis-кеш
  `OtpService` — устройство не является осью, которую знает
  `OtpService`).
- Каждое действие (создание блока, снятие) пишет `SecurityEvent`
  (`PHONE_BLOCKED`/`DEVICE_BLOCKED`) и `AdminAuditLog` — видно в
  `GET /api/v1/admin/audit` и `GET /api/v1/admin/auth/security-events`.
- Снятие блокировки: `POST /api/v1/admin/auth/blocks/:id/unblock` —
  идемпотентно защищено (повторный вызов на уже снятой блокировке даёт
  `409 AUTH_BLOCK_ALREADY_LIFTED`), удаляет Redis-ключ enforcement.

## Refresh-token reuse → отзыв всей «семьи»

`DeviceSession.tokenFamilyId` — общий для сессии на протяжении всех
ротаций refresh-токена (см. `AuthService.refresh`), меняется только при
новом логине через `verify-code` (не при ротации). При обнаружении
повторного использования уже израсходованного refresh-токена —
`handleRefreshTokenReuse` отзывает **все** сессии с этим
`tokenFamilyId` (а не только одну), пишет `SecurityEvent`
(`REFRESH_TOKEN_REUSE`) и инкрементирует метрику
`auth_refresh_token_reuse_total`. Пользователь должен будет залогиниться
заново на всех устройствах, разделявших эту «семью».
