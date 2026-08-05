# Безопасный self-hosted staging

Это окружение запускает весь staging только на локальном компьютере. Оно не
создаёт ресурсы Yandex Cloud, не использует привязанную банковскую карту и не
подключает настоящие SMS, платежи или карты.

## Состав

- NestJS API;
- admin-web;
- PostgreSQL 17 с PostGIS 3.5;
- Redis с AOF;
- S3-совместимое объектное хранилище MinIO;
- Caddy с локальным HTTPS;
- ежедневные PostgreSQL и Redis backups;
- отдельные Docker volumes для рабочих данных и резервных копий.

PostgreSQL, Redis и внутренние порты приложений не публикуются на сетевых
интерфейсах компьютера. Caddy принимает подключения только на `127.0.0.1`.
Внутренняя Docker-сеть не имеет доступа в интернет, поэтому development
providers не могут обратиться к реальным внешним сервисам.

## Требования

- Node.js 20 или новее;
- pnpm 10;
- Docker Desktop с Docker Compose;
- минимум 8 ГБ свободной оперативной памяти;
- минимум 15 ГБ свободного места.

## Первый запуск

Создайте локальный файл с новыми случайными паролями:

```powershell
pnpm staging:init
```

Файл `.env.staging` исключён из Git. Повторный запуск команды не меняет уже
созданные значения.

Соберите и запустите окружение:

```powershell
pnpm staging:up
```

Первый запуск занимает больше времени, поскольку API, admin-web и актуальная
Community Edition MinIO собираются локально. После запуска доступны:

| Компонент     | Адрес                                                |
| ------------- | ---------------------------------------------------- |
| API health    | `https://backend.localhost:8443/api/v1/health`       |
| API readiness | `https://backend.localhost:8443/api/v1/health/ready` |
| Swagger       | `https://backend.localhost:8443/docs`                |
| admin-web     | `https://admin.localhost:8443`                       |
| MinIO console | `https://storage.localhost:8443`                     |
| S3 endpoint   | `https://s3.localhost:8443`                          |

HTTP-порт `8080` выполняет перенаправление на HTTPS-порт `8443`.

## Локальный сертификат

Caddy использует собственный локальный центр сертификации. До добавления его
сертификата браузер показывает предупреждение, хотя соединение уже
зашифровано.

После запуска экспортируйте сертификат:

```powershell
pnpm staging:https:cert
```

Команда выведет безопасную для текущего пользователя Windows команду
`certutil`. Выполните её вручную, только если доверяете локальным Docker
volumes этого репозитория. Сертификат сохраняется в `.staging/` и не попадает в
Git.

## Тестовые аккаунты

| Роль          | Телефон        |
| ------------- | -------------- |
| Пассажир      | `+79990000001` |
| Водитель      | `+79990000002` |
| Администратор | `+79990000000` |

Development OTP по умолчанию: `111111`. Значения можно изменить в
`.env.staging` до первого запуска.

## Объектное хранилище

При старте создаётся приватный bucket `resilient-taxi-backups`. Логин MinIO
указан в `MINIO_ROOT_USER`, пароль — в `MINIO_ROOT_PASSWORD` локального
`.env.staging`.

MinIO предоставляет S3-совместимую инфраструктуру, но API пока не использует
её для продуктовых файлов. Это соответствует текущему состоянию проекта и не
добавляет новую бизнес-функцию.

## Резервные копии

Сразу после успешных migrations и seed создаются PostgreSQL backup в custom
формате и согласованный Redis RDB snapshot. Далее backups повторяются каждые
24 часа. Перед публикацией в MinIO файлы проверяются через `pg_restore --list`
и `redis-check-rdb`.

По умолчанию сохраняются копии за последние семь дней:

```powershell
pnpm staging:backup
pnpm staging:backups
```

Первая команда создаёт дополнительные копии PostgreSQL и Redis немедленно,
вторая показывает объекты в backup bucket.

Рабочая база, локальные backup-файлы и их копии в MinIO находятся на одном
физическом компьютере. Это защищает от случайного повреждения базы, но не от
поломки или потери компьютера. Для настоящего disaster recovery потребуется
второй физический носитель или внешний storage.

### Проверка восстановления

Восстановление перезаписывает текущую базу и поэтому не автоматизировано
корневой командой. Сначала сохраните ещё одну копию и остановите приложения:

```powershell
pnpm staging:backup
docker compose --env-file .env.staging -f docker-compose.staging.yml stop api admin
docker compose --env-file .env.staging -f docker-compose.staging.yml exec postgres-backup /bin/sh -c 'pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" /backups/postgres-YYYYMMDDTHHMMSSZ.dump'
docker compose --env-file .env.staging -f docker-compose.staging.yml start api admin
```

Замените имя файла на значение из `pnpm staging:backups`. Перед восстановлением
важных данных сделайте копию Docker volumes.

## Управление

```powershell
pnpm staging:status
pnpm staging:logs
pnpm staging:down
```

`staging:down` останавливает контейнеры, но сохраняет все volumes. Для полного
удаления данных потребуется отдельная команда Docker Compose с `--volumes`;
она намеренно не добавлена как короткая команда, чтобы снизить риск случайной
потери данных.

## Ограничения

- окружение доступно только на текущем компьютере;
- локальный сертификат не является публичным сертификатом;
- MinIO и backups используют тот же физический диск;
- development providers разрешены только из-за `NODE_ENV=development`;
- окружение не предназначено для production.
