# Деплой staging

## Первый деплой (последовательность)

1. Подготовить хост (Ubuntu VM с установленным Docker + Docker Compose
   v2, как в `docs/deploy/yandex-cloud.md`), направить домены
   `STAGING_API_DOMAIN`/`STAGING_ADMIN_DOMAIN` на его публичный IP.
2. Склонировать репозиторий на хост.
3. `cp .env.staging.example .env.staging` и заполнить все секреты
   (`openssl rand -base64 48` для `AUTH_*`/`PAYMENTS_WEBHOOK_SECRET`/
   `OBJECT_STORAGE_SECRET_KEY`, реальные значения для доменов/почты ACME).
   **Никогда не использовать production-секреты** — это отдельные,
   собственные значения только для staging.
4. `pnpm install --frozen-lockfile` (нужен для локальных
   staging-скриптов, которые запускаются через `pnpm --filter ...`,
   даже если сами сервисы работают в Docker).
5. `pnpm staging:up` — собирает образы, поднимает Postgres/Redis/MinIO,
   применяет миграции (`migrate` — one-shot), стартует `api`/`admin-web`/
   `caddy`, ждёт healthy (`--wait`).
6. `pnpm staging:seed` — создаёт SUPER_ADMIN, тестового пассажира,
   верифицированного водителя с автомобилем, тариф комиссии для одного
   города (идемпотентно, можно запускать повторно).
7. `pnpm staging:smoke` — полный прогон поездки, realtime, object storage,
   аудит-лог. Если упал — деплой не считается успешным, см.
   `docs/staging/smoke-tests.md` и `docs/staging/rollback.md`.
8. Проверить `https://<STAGING_API_DOMAIN>/api/v1/health/ready` и
   `https://<STAGING_ADMIN_DOMAIN>/login` вручную из браузера — первый
   реальный запрос через Caddy (Let's Encrypt должен успеть выпустить
   сертификат — обычно секунды после первого HTTPS-запроса на домен).

## Последующие деплои

Через `pnpm staging:deploy` (`scripts/staging/deploy.sh`):
проверка git-статуса → lint → typecheck → test → сборка образов →
бэкап текущей БД (пропускается на первом деплое, если Postgres ещё не
поднят) → `docker compose up -d --wait` (билд + миграция + старт,
привязано к healthcheck'ам) → ожидание `/health/ready` → smoke-тест →
итоговая сводка. Любой шаг после бэкапа, завершившийся неудачно,
печатает инструкции по откату (`pnpm staging:restore --yes`) и
завершается с ненулевым кодом — скрипт никогда не объявляет деплой
успешным по предположению.

## CI: `.github/workflows/staging-deploy.yml`

- Триггеры: `workflow_dispatch` (вручную) и push в `master` (можно
  убрать, если staging должен деплоиться только вручную).
- GitHub Environment `staging` хранит секреты: `STAGING_SSH_HOST`,
  `STAGING_SSH_USER`, `STAGING_SSH_PRIVATE_KEY`, `STAGING_DEPLOY_PATH`.
  Сам `.env.staging` на хосте workflow не создаёт и не трогает — только
  собирает образы и просит хост их подтянуть и перезапустить сервисы.
- **Build-once**: оба образа (`api`, `admin-web`) собираются один раз и
  пушатся в GHCR с тегом, равным commit SHA (плюс плавающий
  `staging-latest` только для удобного просмотра — деплой всегда тянет
  именно SHA-тег). `docker-compose.staging.yml` объявляет `image:` рядом
  с `build:` на этих двух сервисах — при локальном/ручном
  `pnpm staging:up --build` ничего не меняется (используется локальный
  тег), а CI выставляет `STAGING_API_IMAGE`/`STAGING_ADMIN_IMAGE` и
  делает `docker compose pull` + `up -d` без пересборки на хосте.
- Конкуренция: `concurrency: {group: staging-deploy, cancel-in-progress:
false}` — деплои выстраиваются в очередь, а не гоняются друг с другом.
- После деплоя: smoke-тест на хосте по SSH, его вывод — артефакт workflow
  (`staging-smoke-report`), плюс сводка в `$GITHUB_STEP_SUMMARY`. Секреты
  нигде не печатаются.
- **Явно не настраивает production-деплой** — совершенно отдельный
  workflow, отдельный Environment, не трогает `docker-compose.prod.yml`/
  `docker-compose.managed.yml`.

**Известное ограничение**: этот workflow не был прогнан на реальном
runner/хосте в среде, где писалась эта задача (нет живой staging VM и
настроенного GitHub Environment для проверки). YAML провалидирован
(корректно парсится), структура следует стандартным, широко используемым
экшенам (`docker/build-push-action`, `docker/login-action`,
`appleboy/ssh-action`), но перед первым реальным использованием стоит
внимательно свериться с реальным staging-хостом.

## Стратегия тегов образов

- `ghcr.io/<repo>-api:<commit-sha>` / `ghcr.io/<repo>-admin-web:<commit-sha>` —
  неизменяемые, именно они деплоятся.
- `ghcr.io/<repo>-api:staging-latest` / `...-admin-web:staging-latest` —
  для удобного ручного просмотра последнего собранного образа, деплой на
  них никогда не полагается.
