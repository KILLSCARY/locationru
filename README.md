# Resilient Taxi

Монорепозиторий сервисов и клиентских приложений платформы Resilient Taxi.
Проект использует pnpm workspaces и Turborepo. На этом этапе добавлен только
базовый технический каркас без бизнес-логики, Firebase и платёжных SDK.

## Требования

- Node.js 20 или новее
- pnpm 10

## Начало работы

```bash
pnpm install
cp .env.example .env
pnpm dev
```

В PowerShell файл окружения можно создать командой:

```powershell
Copy-Item .env.example .env
```

## Непрерывная интеграция

На каждый pull request и push в `master` GitHub Actions
(`.github/workflows/ci.yml`) прогоняет проверки backend
(`format:check`, `lint`, `typecheck`, `test`) и модуля `domain` приложения
водителя (`:domain:test`, `ktlintCheck`, `detekt`).

## Команды

- `pnpm dev` — запустить проекты в режиме разработки
- `pnpm build` — собрать все проекты
- `pnpm lint` — проверить код ESLint
- `pnpm typecheck` — проверить типы TypeScript
- `pnpm test` — запустить тесты
- `pnpm format` — отформатировать файлы Prettier
- `pnpm format:check` — проверить форматирование
- `pnpm infra:up` — запустить PostgreSQL/PostGIS и Redis
- `pnpm infra:down` — остановить инфраструктуру
- `pnpm infra:logs` — показать логи инфраструктуры в реальном времени

### API

- `pnpm --filter @resilient-taxi/api start:dev` — запустить API с перезагрузкой
- `pnpm --filter @resilient-taxi/api build` — собрать API
- `pnpm --filter @resilient-taxi/api test` — запустить unit- и e2e-тесты
- `pnpm --filter @resilient-taxi/api test:e2e` — запустить только e2e-тесты
- `pnpm --filter @resilient-taxi/api prisma:generate` — сгенерировать Prisma Client
- `pnpm --filter @resilient-taxi/api db:migrate` — создать/применить dev-миграции
- `pnpm --filter @resilient-taxi/api db:migrate:deploy` — применить готовые миграции
- `pnpm --filter @resilient-taxi/api db:seed` — создать development-администратора

После запуска API использует префикс `/api/v1`. Проверки состояния доступны по
адресам:

- `GET /api/v1/health` — процесс API работает
- `GET /api/v1/health/ready` — PostgreSQL и Redis доступны

Swagger UI доступен только при `NODE_ENV=development` по адресу `/docs`.

### Административная панель

```bash
pnpm --filter @resilient-taxi/admin-web dev
```

Панель доступна по `http://localhost:3001`, если API запущен на порту 3000.
Переменная `API_URL` задаёт базовый URL API для серверного доступа панели. Вход
возможен только для пользователя с ролью `ADMIN`; в development OTP-код пишет
в лог API.

Авторизация доступна через `/api/v1/auth`. В development одноразовый код
появляется только в JSON-логе `DevelopmentSmsProvider`. Параметры срока действия,
rate limit и количества попыток задаются переменными `AUTH_*` из `.env`.
Подробности протокола: [`docs/api/authentication.md`](docs/api/authentication.md).

Модель поездки и централизованная машина состояний описаны в
[`docs/architecture/trip-domain.md`](docs/architecture/trip-domain.md). REST
endpoint’ы пассажирского заказа доступны в `/api/v1/trips`. Минимальная цена
задаётся переменной `TRIPS_MIN_PASSENGER_PRICE_KOPECKS`.

## Локальная инфраструктура

Для запуска необходим Docker с поддержкой Compose. Сначала создайте локальный
файл окружения и замените демонстрационные пароли:

```bash
cp .env.example .env
pnpm infra:up
```

Команда запуска ожидает, пока healthcheck PostgreSQL и Redis завершатся успешно.
После запуска доступны:

- PostgreSQL 17 с PostGIS 3.5 — `localhost:5432`
- Redis 7.4 — `localhost:6379`

Порты можно изменить через `POSTGRES_PORT` и `REDIS_PORT` в `.env`.
Расширение PostGIS создаётся автоматически при первой инициализации базы.

Проверить его наличие можно командой:

```bash
docker compose exec postgres psql -U resilient_taxi -d resilient_taxi \
  -c "SELECT PostGIS_Version();"
```

Данные PostgreSQL и Redis хранятся в отдельных именованных Docker volumes и
сохраняются после `pnpm infra:down` и повторного `pnpm infra:up`. Обычная команда
остановки не удаляет volumes. Для просмотра логов используйте
`pnpm infra:logs`.

## Структура

- `apps/api` — серверное API
- `apps/admin-web` — веб-приложение администратора
- `apps/passenger-mobile` — мобильное приложение пассажира
- `apps/driver-android` — Android-приложение водителя (Kotlin, Compose)
- `packages/contracts` — контракты взаимодействия
- `packages/shared-types` — общие TypeScript-типы
- `packages/config` — общая конфигурация
- `infrastructure` — конфигурация Docker, PostgreSQL и Redis
- `docs` — архитектурная и предметная документация

## Дальнейшее развитие

Текущее состояние и план работ по этапам описаны в
[`docs/ROADMAP.md`](docs/ROADMAP.md).
