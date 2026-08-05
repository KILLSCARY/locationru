# Бэкапы и восстановление Postgres

Инструменты: `scripts/staging/backup.sh`, `backup-list.sh`, `restore.sh`
(`pnpm staging:backup`, `staging:backup:list`, `staging:restore`).

## Формат и хранение

- `pg_dump` в custom-формате (`-F c`) — компактнее и быстрее для
  выборочного восстановления, чем plain SQL.
- Имя файла: `resilient-taxi-staging-<UTC timestamp>.dump`.
- Рядом пишется `<файл>.sha256` (реальный вывод `sha256sum`, не только
  хеш — так `sha256sum -c` может проверить файл напрямую).
- Каталог: `STAGING_BACKUP_DIR` (по умолчанию
  `/var/backups/resilient-taxi-staging` на реальном хосте).
- Ретеншн: `STAGING_BACKUP_RETENTION_DAYS` (по умолчанию 14) — файлы
  старше удаляются при каждом запуске `backup.sh`.

## RPO/RTO

Единственный механизм бэкапа — этот скрипт, поэтому фактический RPO
(recovery point objective) равен «с момента последнего успешного запуска
`backup.sh`». Рекомендуется запускать не реже раза в сутки — пример
таймера ниже. RTO (recovery time objective) — время, которое занимает
`restore.sh` плюс, при необходимости, накат новых миграций поверх
восстановленной БД; для staging-объёмов данных это практически всегда
сильно меньше 15 минут (сам `pg_restore` для дампа такого размера
занимает секунды-минуты, основное время — ручные шаги оператора).

## Автоматический ежедневный запуск

`infrastructure/systemd/resilient-taxi-staging-backup.service` +
`.timer` — пример systemd-таймера (03:00 UTC ежедневно,
`Persistent=true`, т.е. пропущенный из-за выключенной машины запуск
выполнится при следующей загрузке). Установка на реальном хосте:

```bash
sudo cp infrastructure/systemd/resilient-taxi-staging-backup.* /etc/systemd/system/
sudo nano /etc/systemd/system/resilient-taxi-staging-backup.service  # поправить WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now resilient-taxi-staging-backup.timer
```

`pnpm staging:backup` идемпотентно-безопасен для повторного/пересекающегося
запуска — каждый запуск просто добавляет новый файл с своим timestamp.

## Восстановление

`restore.sh` (через `pnpm staging:restore --yes [путь/к/файлу.dump]`):

1. **Требует явного `--yes`** — без флага завершается с ошибкой и
   ничего не делает, независимо от интерактивности сессии.
2. **Сначала бэкапит текущее состояние** — вызывает `backup.sh` перед
   тем, как что-либо менять, так что неудачное восстановление тоже
   восстановимо.
3. **Проверяет контрольную сумму** выбранного дампа перед восстановлением
   — если она не совпадает, восстановление не начинается.
4. Без указанного пути — берёт самый свежий файл в `STAGING_BACKUP_DIR`.
5. `pg_restore --clean --if-exists --no-owner --no-privileges` —
   пересоздаёт объекты в существующей базе.

Проверено локально: guard-клоза «нет `--yes`» и guard-клоза
«несовпадение контрольной суммы» — оба отработаны напрямую (оба
завершаются с ненулевым кодом до какого-либо обращения к docker/БД).
Сам путь `pg_dump`/`pg_restore` не проверялся в этой среде — здесь нет
доступного демона Docker.

## Просмотр списка бэкапов

`pnpm staging:backup:list` — таблица: имя файла, размер, время
изменения, статус контрольной суммы (`ok` / `MISMATCH` / `missing`).
