# Платежи

Платёжная подсистема построена вокруг интерфейса `PaymentProvider`
(`apps/api/src/payments/payment-provider.ts`). Сервис `PaymentService`, модель
данных Prisma, идемпотентность и обработка вебхуков не зависят от конкретного
шлюза — вся интеграция локализована за этим интерфейсом.

## Выбор провайдера

Провайдер выбирается фабрикой `createPaymentProvider`
(`payment-provider.factory.ts`) по конфигурации:

- `PAYMENTS_PROVIDER=development` — локальный детерминированный симулятор
  `DevelopmentPaymentProvider`. Не переводит реальные деньги, запрещён в
  production (двойная защита: env-валидация и проверка в фабрике).
- `PAYMENTS_PROVIDER=http` — боевая заготовка `HttpPaymentProvider`. В
  production это значение обязательно.

Идентификатор провайдера (`provider.name`) сохраняется в `PaymentIntent`,
`DriverPayout` и `PaymentWebhookEvent`, поэтому записи остаются
самоописывающими при смене шлюза.

## Конфигурация (`PAYMENTS_*`)

| Переменная                    | Назначение                                                   |
| ----------------------------- | ------------------------------------------------------------ |
| `PAYMENTS_PROVIDER`           | `development` или `http`                                     |
| `PAYMENTS_API_BASE_URL`       | Базовый URL шлюза (обязателен при `http`)                    |
| `PAYMENTS_API_KEY`            | Ключ авторизации (обязателен при `http`)                     |
| `PAYMENTS_WEBHOOK_SECRET`     | Секрет для проверки подписи вебхуков (обязателен при `http`) |
| `PAYMENTS_REQUEST_TIMEOUT_MS` | Таймаут HTTP-запроса, 1000–60000 мс                          |

## Подключение реального шлюза

1. Реализовать методы `HttpPaymentProvider` (`createPayment`,
   `capturePayment`, `cancelPayment`, `refundPayment`, `getPaymentStatus`,
   `createDriverPayout`) через готовый защищённый хелпер `request()`. Сейчас
   они кидают `NotImplemented`, чтобы production не имитировал платежи.
2. При необходимости уточнить `verifyWebhook`: по умолчанию проверяется
   HMAC-SHA256 (hex) от тела запроса, сравнение — `timingSafeEqual`. Схема
   подписи и подписываемый материал зависят от шлюза.
3. Сопоставить статусы шлюза с доменными (`AUTHORIZED`, `CAPTURED`,
   `CANCELED`, `FAILED`, `REFUNDED`).
4. Добавить E2E-тесты на sandbox-окружении провайдера.

Идемпотентность обеспечивается на уровне `PaymentService`: intent — по
`idempotencyKey`, транзакции capture/cancel/refund — по `idempotencyKey`,
вебхуки — по паре `(provider, providerEventId)`.
