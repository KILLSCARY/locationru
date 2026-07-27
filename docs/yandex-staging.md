# Staging в Яндекс Облаке

Это стартовое окружение предназначено только для демонстрации и интеграционных
проверок. Оно не является production-средой и использует development-провайдеры
SMS и платежей: реальное SMS и движение денег не выполняются.

## Состав и стоимость

Все сервисы запущены на одной VM:

- Ubuntu 24.04, 2 vCPU с гарантированной долей 20%, 4 ГБ RAM;
- сетевой HDD 20 ГБ;
- PostgreSQL 17 + PostGIS 3.5;
- Redis 7.4;
- API и admin-web;
- Caddy с автоматическим публичным HTTPS.

Оценка консоли Яндекс Облака на момент создания — **1 958,05 ₽ в месяц** при
непрерывно работающей VM. Это оценка, а не жёсткий лимит. Остановленная VM не
потребляет vCPU и RAM, но диск продолжает храниться и тарифицироваться.

Резервные копии загружаются в приватный bucket
`resilient-taxi-staging-b1gretmvme2glnupmsog`. Bucket ограничен 1 ГБ, а объекты
с префиксом `backups/` автоматически удаляются через 7 дней.

## Безопасность

- PostgreSQL и Redis доступны только во внутренней Docker-сети.
- Снаружи открыты TCP-порты 22, 80 и 443.
- SSH использует ключи; вход по паролю не настраивается.
- Секреты хранятся только в `/opt/resilient-taxi/.env.staging` на VM.
- В Git и Docker Compose секретов нет.
- Для Object Storage VM получает короткоживущий IAM-токен из metadata service.
  Статический access key не создаётся.
- Сервисному аккаунту выдана только роль `storage.uploader`.

Динамический публичный IP включается в имена `api.<IP>.sslip.io` и
`admin.<IP>.sslip.io`. После остановки и повторного запуска VM IP может
измениться. В таком случае нужно повторно запустить bootstrap, чтобы обновить
домены и HTTPS-сертификаты.

## Первое развёртывание

На VM репозиторий должен находиться в `/opt/resilient-taxi`. Команда
развёртывания выполняется из SSH-сессии:

```bash
cd /opt/resilient-taxi
sudo bash scripts/yandex-bootstrap.sh
```

Скрипт устанавливает Docker, создаёт случайные локальные секреты, применяет
миграции, запускает контейнеры и включает системный таймер выгрузки backup.
Повторный запуск безопасно обновляет конфигурацию для текущего публичного IP.

## Управление

Проверить контейнеры:

```bash
cd /opt/resilient-taxi
sudo docker compose --env-file .env.staging -f docker-compose.yandex.yml ps
```

Посмотреть логи:

```bash
sudo docker compose --env-file .env.staging -f docker-compose.yandex.yml logs --tail 200
```

Проверить timer и последнюю выгрузку backup:

```bash
systemctl list-timers resilient-taxi-backup.timer
sudo journalctl -u resilient-taxi-backup.service -n 100
```

Остановить приложения, сохранив PostgreSQL/Redis volumes:

```bash
sudo docker compose --env-file .env.staging -f docker-compose.yandex.yml down
```

Команда `down` без `--volumes` не удаляет данные. Удаление VM или Docker volumes
необратимо и не входит в обычное обслуживание.
