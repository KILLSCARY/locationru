# Деплой на Yandex Cloud

Backend — NestJS API + PostgreSQL 17 c PostGIS + Redis + WebSocket (socket.io).
Ниже два варианта: быстрый (одна ВМ со всем в Docker) и продовый (managed-БД).

Для реального сервиса с пользователями из РФ учитывайте 152-ФЗ: персональные
данные граждан РФ должны храниться на серверах в России — Yandex Cloud этому
соответствует.

Артефакты в репозитории:

- `docker-compose.prod.yml` — всё в Docker на одной ВМ (Postgres+PostGIS, Redis,
  миграции, API, Caddy с авто-HTTPS).
- `docker-compose.managed.yml` — только миграции + API + Caddy, данные во
  внешних managed-сервисах.
- `.env.prod.example` — шаблон окружения.
- `infrastructure/caddy/Caddyfile` — reverse-proxy + TLS.

---

## Вариант A. Одна ВМ (быстрый старт)

### 1. Создать Compute-инстанс

В консоли Yandex Cloud → **Compute Cloud** → создать ВМ:

- ОС: Ubuntu 22.04/24.04, 2 vCPU / 4 ГБ RAM / 20+ ГБ диск.
- Публичный IP: включить.
- Security group: разрешить входящие **22** (SSH), **80** и **443** (HTTP/S).

### 2. Направить домен

A-запись `api.example.com` → публичный IP ВМ (у своего DNS-провайдера).
Дождитесь распространения (`dig api.example.com`).

### 3. Установить Docker на ВМ

```bash
ssh yc-user@<VM_IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && exit   # перелогиниться
```

### 4. Получить код и настроить окружение

```bash
git clone https://github.com/killscary/locationru.git
cd locationru
cp .env.prod.example .env
# заполнить: DOMAIN, ACME_EMAIL, пароли БД/Redis, секреты AUTH_* (openssl rand -base64 48)
nano .env
```

### 5. Запустить

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

`migrate` применит миграции и завершится, затем поднимутся `api` и `caddy`
(Caddy сам получит TLS-сертификат Let's Encrypt для `DOMAIN`).

### 6. Создать администратора (dev-seed)

```bash
docker compose -f docker-compose.prod.yml run --rm migrate \
  pnpm --filter @resilient-taxi/api db:seed
```

### 7. Проверить

```bash
curl https://api.example.com/api/v1/health/ready   # {"status":"ok",...}
```

---

## Вариант B. Managed-сервисы (продовый, 152-ФЗ)

1. **Managed Service for PostgreSQL**: создать кластер (PostgreSQL 17), базу и
   пользователя. В настройках кластера включить расширение **`postgis`**.
2. **Managed Service for Redis (Valkey)**: создать кластер, задать пароль.
3. В `.env` указать managed-эндпоинты (обычно с TLS):
   ```
   DATABASE_URL=postgresql://user:pass@<mpg-host>:6432/db?sslmode=require
   REDIS_URL=rediss://:pass@<redis-host>:6379
   ```
4. Запустить без локальных БД:
   ```bash
   docker compose -f docker-compose.managed.yml up -d --build
   ```

---

## Подключить приложение водителя

Собрать APK против вашего сервера — через workflow **Android APK** (поле
`api_base_url`) или локально:

```bash
./gradlew :app:assembleDevDebug \
  -PdriverDevApiBaseUrl=https://api.example.com/api/v1/
```

## Вход по OTP

Пока реальный SMS-шлюз не подключён, оставьте в `.env` `NODE_ENV=development` и
`SMS_PROVIDER=development` — тогда одноразовый код печатается в лог API:

```bash
docker compose -f docker-compose.prod.yml logs -f api   # ищите auth.development_otp
```

Для настоящего production (`NODE_ENV=production`) обязательны `SMS_PROVIDER=http`
и `PAYMENTS_PROVIDER=http` с реальными значениями — и доработка этих провайдеров
(методы-заготовки пока кидают `NotImplemented`).

## Обновление

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```
