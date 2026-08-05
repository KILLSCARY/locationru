# Вебхук статуса доставки SMS.RU

`POST /api/v1/webhooks/sms/sms-ru` — `apps/api/src/webhooks/`.

## Аутентичность без JWT

У вебхука нет пользовательской сессии, чтобы предъявить Bearer-токен.
Основная (и единственная обязательная) проверка — общий секрет в query
string самого callback URL: `?token=<SMS_RU_WEBHOOK_SECRET>`,
сравнивается через `timingSafeEqual`
(`SmsWebhookService.assertAuthentic`). Если `SMS_RU_WEBHOOK_SECRET` не
задан в конфиге — вебхук отклоняет вообще все запросы (`401
INVALID_WEBHOOK_TOKEN`), а не «открывается».

IP-allowlist (`SMS_RU_WEBHOOK_IP_ALLOWLIST`) — **вторичная** проверка:
применяется, только если список не пуст, и никогда не заменяет
проверку токена. Пустой список = проверка по IP отключена (это
осознанный выбор: список исходящих IP провайдера может меняться, и
жёсткая привязка к IP без токена была бы более хрупкой защитой, чем
токен без IP).

## Сырое тело запроса

SMS.RU не гарантирует конкретный формат callback'а (JSON или
`application/x-www-form-urlencoded`), поэтому:

1. `apps/api/src/webhooks/raw-body.middleware.ts` — регистрируется в
   `bootstrap.ts` **до** JSON body-parser'а и только для пути
   `/api/v1/webhooks/sms/sms-ru`. Он перехватывает поток запроса и
   кладёт точные байты в `req.rawBody`, прежде чем что-либо их
   распарсит.
2. `SmsRuProvider.handleStatusWebhook(rawBody, headers)` сам решает,
   парсить ли тело как JSON или как `URLSearchParams`, в зависимости от
   `Content-Type`.
3. `rawEventHash` — `sha256(rawBody)` — используется для идемпотентости
   (уникальный индекс на `SmsWebhookEvent.rawEventHash`). Повторная
   доставка того же события (SMS.RU ретраит недоставленные callback'и)
   — no-op, не переобрабатывается второй раз.

## Обработка

```
POST /api/v1/webhooks/sms/sms-ru?token=...
  → assertAuthentic (токен, опционально IP)
  → SmsProvider.handleStatusWebhook(rawBody, headers) → NormalizedWebhookEvent
  → SmsWebhookEvent.findUnique(rawEventHash) — если уже есть, вернуть {status:'ok'} сразу
  → SmsWebhookEvent.create(...)
  → OtpRequest.updateMany({providerMessageId}, {providerStatus}) — если providerMessageId известен
  → {status: 'ok'}
```

Ответ всегда быстрый и минимальный — ни номер телефона, ни какие-либо
PII в теле ответа никогда не возвращаются. `rawBody` нигде не
сохраняется целиком (только его хеш) — минимизация PII в хранилище.

**Ограничение (честно, не реализовано):** «queue-style processing»
в буквальном смысле (очередь сообщений, асинхронная обработка) не
реализовано — в кодовой базе нет инфраструктуры очередей (Bull/BullMQ и
т.п.), а вводить её только ради этого вебхука means добавить
существенно новую инфраструктурную зависимость сверх того, что просили.
Обработка вебхука делает 1–3 быстрых запроса к Postgres синхронно в
рамках HTTP-запроса — этого достаточно, чтобы уложиться в разумное
время ответа (нет тяжёлых операций, нет сетевых вызовов вовне), но это
не настоящая очередь. Если объём вебхуков вырастет настолько, что это
станет узким местом, — следующий шаг это добавить реальную очередь
(BullMQ поверх Redis, который уже есть в стеке).

## Нормализованные статусы

`SmsDeliveryStatus`: `QUEUED | SENT | DELIVERED | FAILED | EXPIRED |
REJECTED | UNKNOWN`. Маппинг числовых кодов SMS.RU →
`docs/auth/sms-providers.md#нормализация-статусов`.
