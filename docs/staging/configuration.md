# Конфигурация staging

Шаблон: `.env.staging.example` (корень репозитория). Скопируйте в
`.env.staging` и заполните секреты перед первым `pnpm staging:up`.

## Fail-fast валидация

`apps/api/src/config/env.validation.ts` — Joi-схема, которая проверяется
синхронно при старте (`NestConfigModule.forRoot({validationSchema, ...})`,
`abortEarly: false` — при ошибке приложение не поднимется вообще, и в
логе будут перечислены сразу все проблемы, а не только первая). Для
staging/production схема отвергает:

- dev-провайдеры SMS/платежей (`SMS_PROVIDER=development`,
  `PAYMENTS_PROVIDER=development`) — только `staging` или `http`;
- dev-провайдер карт, если явно не разрешён
  `MAPS_ALLOW_DEVELOPMENT_IN_STAGING=true`;
- «демо»-секреты (список известных placeholder-значений в
  `KNOWN_DEMO_SECRETS` — `AUTH_JWT_SECRET`, `AUTH_OTP_HASH_SECRET`,
  `TRIPS_BOARDING_CODE_HASH_SECRET`, `PAYMENTS_WEBHOOK_SECRET`,
  `OBJECT_STORAGE_SECRET_KEY` не могут совпадать с ними);
- `ENABLE_DEVELOPMENT_OTP` / `ENABLE_DEVELOPMENT_PAYMENTS` — принудительно
  `false` в staging/production;
- `ENABLE_SWAGGER=true` вне development (Swagger не должен быть публичным
  в staging);
- отсутствие `DATABASE_URL`/`REDIS_URL`/`OBJECT_STORAGE_*` при
  `requiresHardenedConfig`;
- `CORS_ALLOWED_ORIGINS`/`WEBSOCKET_ALLOWED_ORIGINS`, содержащие `"*"` —
  запрещено безусловно, в любом окружении, не только в staging.

Проверено отдельным файлом `apps/api/src/config/env.validation.spec.ts`
(21 тест) — он напрямую валидирует Joi-схему на фикстуре
`BASE_STAGING_ENV`, по одному тесту на каждое условие выше, плюс блок
«development остаётся permissive».

### Найденный и исправленный баг Joi

При написании этой схемы обнаружился скрытый, ранее не замеченный баг:
`Joi.string().valid(a, b, c).default(x).when(ref, {is, then, otherwise})`
**не** позволяет `then`/`otherwise` сузить набор допустимых значений —
предшествующий `.valid()` действует как безусловная алтернатива через OR.
Проверено изолированными скриптами `node -e` против реально установленной
версии Joi (18.0.2), включая воспроизведение точно такого же паттерна,
который уже существовал в кодовой базе до этой задачи — баг был
безобидным на практике только потому, что отдельные `if`-проверки на
уровне фабрики независимо дублировали те же правила. Исправление:
никогда не ставить `.valid()` перед `.when()` — вместо этого полный
список допустимых значений указывается внутри каждой ветки `then`/
`otherwise` (самый вложенный `otherwise` содержит самый разрешающий
список). Затронуло `SMS_PROVIDER`, `PAYMENTS_PROVIDER`, `MAPS_PROVIDER`.

## Отклонения от буквальных имён переменных в задании

Задание предлагало определённые имена переменных — часть из них не
соответствует реальной архитектуре этого кода, отклонения намеренные и
задокументированы прямо в `.env.staging.example`:

- `AUTH_JWT_SECRET` / `AUTH_OTP_HASH_SECRET` /
  `AUTH_ACCESS_TOKEN_TTL_SECONDS` / `AUTH_REFRESH_TOKEN_TTL_SECONDS` /
  `TRIPS_BOARDING_CODE_HASH_SECRET` используются вместо предполагаемых
  `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`JWT_ACCESS_TTL_SECONDS`/
  `JWT_REFRESH_TTL_SECONDS` — потому что refresh-токены в этой системе
  представляют собой непрозрачные scrypt-хешированные значения сессии,
  а не JWT, так что общего «refresh-секрета» просто не существует, чтобы
  его задавать.
- `PAYMENTS_PROVIDER` (множественное число) используется вместо
  `PAYMENT_PROVIDER` — так исторически называется переменная в этом
  кодовом слое (`payments.provider` в `configuration.ts`).

## Ключевые группы переменных

| Группа         | Примеры                                                                                                                                                     | Назначение                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Приложение     | `APP_ENV`, `API_HOST`, `API_PUBLIC_URL`, `ADMIN_PUBLIC_URL`, `HTTP_BODY_LIMIT_BYTES`                                                                        | Базовая идентификация окружения и лимит тела запроса                       |
| БД/Redis       | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `REDIS_PASSWORD`                                                                                                 | Подключения к данным                                                       |
| Auth           | `AUTH_JWT_SECRET`, `AUTH_OTP_*`, `TRIPS_BOARDING_CODE_HASH_SECRET`                                                                                          | Секреты аутентификации и посадочного кода                                  |
| CORS/WS        | `CORS_ALLOWED_ORIGINS`, `WEBSOCKET_ALLOWED_ORIGINS`, `WEBSOCKET_MAX_CONNECTIONS_PER_USER`, `WEBSOCKET_HEARTBEAT_*`, `WEBSOCKET_EVENT_RATE_LIMIT_PER_MINUTE` | Жёсткая настройка CORS и WS                                                |
| SMS            | `SMS_PROVIDER=staging`, `SMS_SENDER`                                                                                                                        | Провайдер OTP                                                              |
| Платежи        | `PAYMENTS_PROVIDER=staging`, `PAYMENTS_WEBHOOK_SECRET`, `STAGING_PAYMENT_DEFAULT_SCENARIO`                                                                  | Провайдер и сценарий по умолчанию                                          |
| Карты          | `MAPS_PROVIDER`, `MAPS_ALLOW_DEVELOPMENT_IN_STAGING`, `MAPS_API_KEY`                                                                                        | Провайдер карт                                                             |
| Object Storage | `OBJECT_STORAGE_*`                                                                                                                                          | MinIO/S3: endpoint, ключи, лимиты, TTL presigned URL                       |
| Наблюдаемость  | `LOG_LEVEL`, `ERROR_REPORTER`, `ERROR_REPORTER_DSN`                                                                                                         | Логи и отчёты об ошибках                                                   |
| Флаги          | `ENABLE_SWAGGER`, `ENABLE_DEVELOPMENT_OTP`, `ENABLE_DEVELOPMENT_PAYMENTS`                                                                                   | Всегда `false` в staging (кроме Swagger, который просто не нужен публично) |
| Бэкапы         | `STAGING_BACKUP_DIR`, `STAGING_BACKUP_RETENTION_DAYS`                                                                                                       | См. `docs/staging/backups.md`                                              |
| Домены         | `STAGING_API_DOMAIN`, `STAGING_ADMIN_DOMAIN`, `ACME_EMAIL`                                                                                                  | Для Caddy и автоматического HTTPS                                          |

Полный, актуальный список — всегда в `.env.staging.example` с
комментариями; эта таблица — только ориентир по категориям.
