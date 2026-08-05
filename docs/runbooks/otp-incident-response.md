# Runbook: инциденты OTP-авторизации

## Быстрая диагностика

1. **Метрики** — `GET /metrics` (Prometheus text format,
   `apps/api/src/observability/metrics.service.ts`). Ключевые серии:
   - `auth_otp_requests_total{purpose,channel}` — объём запросов кода.
   - `auth_otp_verify_total{purpose,result}` — `result` ∈
     `success|invalid|expired|blocked`. Резкий рост `invalid`/`blocked`
     относительно `success` — сигнал брутфорса или сломанного клиента.
   - `auth_otp_blocks_total{purpose,reason}` — `reason` ∈
     `MAX_ATTEMPTS_EXCEEDED|RESEND_ABUSE`.
   - `auth_refresh_token_reuse_total` — каждое срабатывание отзывает
     целую «семью» сессий; частые срабатывания у одного пользователя —
     повод проверить, не скомпрометирован ли refresh-токен (украден и
     используется параллельно с легитимным клиентом).
   - `auth_sms_webhook_events_total{status,duplicate}` — если
     `duplicate="true"` growing быстро, проверить, не ретраит ли SMS.RU
     из-за 5xx на нашей стороне.

   Метрики **никогда** не используют номер телефона как label —
   только enum-значения (`purpose`/`channel`/`result`/`reason`/
   `status`). См. `src/observability/metrics.service.spec.ts`, тест
   на этот инвариант.

2. **Security events** — `GET /api/v1/admin/auth/security-events`
   (роль ADMIN/SUPER_ADMIN, опциональный фильтр `?type=`). Типы:
   `OTP_BRUTE_FORCE_SUSPECTED`, `REFRESH_TOKEN_REUSE`, `PHONE_BLOCKED`,
   `DEVICE_BLOCKED`, `PROVIDER_CIRCUIT_OPEN` (последний зарезервирован
   в схеме, но пока ничего его не пишет — `SmsRuProvider`'s circuit
   breaker не логирует событие при открытии, только меняет внутреннее
   состояние; см. «Известные пробелы» ниже).

3. **Активные блокировки** — `GET /api/v1/admin/auth/blocks?activeOnly=true`.

## Условия, требующие внимания (рекомендуемые alert-правила)

Готовой интеграции с Alertmanager/Prometheus-сервером в репозитории
нет (только `/metrics`-эндпоинт для скрейпа) — ниже примерные PromQL
выражения на случай, если Prometheus будет развёрнут отдельно:

```promql
# Резкий рост неуспешных верификаций относительно успешных за 5 минут
sum(rate(auth_otp_verify_total{result=~"invalid|blocked"}[5m]))
  / sum(rate(auth_otp_verify_total{result="success"}[5m]) + 0.001) > 3

# Повторное использование refresh-токена — должно быть околонулевым в норме
increase(auth_refresh_token_reuse_total[15m]) > 0

# SMS.RU вебхук не приходит вообще (может означать, что callback URL
# в кабинете SMS.RU настроен неверно, см. docs/auth/sms-ru-setup.md)
increase(auth_sms_webhook_events_total[1h]) == 0
  and increase(auth_otp_requests_total{channel="SMS"}[1h]) > 0
```

## Разблокировать номер/устройство вручную

```
POST /api/v1/admin/auth/blocks/:id/unblock
```

(id — из `GET /api/v1/admin/auth/blocks`). Действие аудируется
(`AdminAuditLog`, action `AUTH_BLOCK_LIFTED`) и снимает Redis-ключ
enforcement для блокировок по телефону немедленно.

## Проверить баланс/доступность SMS.RU

```
GET /api/v1/admin/auth/sms-balance
```

Возвращает `503 BALANCE_CHECK_UNAVAILABLE`, если активный провайдер —
не `SmsRuProvider` (т.е. `SMS_PROVIDER` сейчас `development`/`staging`).
Если баланс близок к нулю — пополнить в личном кабинете SMS.RU (см.
`docs/auth/sms-ru-setup.md`).

## Если Redis недоступен

Все новые OTP-запросы и верификации будут получать `503
OTP_STORE_UNAVAILABLE` (`OtpService`) или `503
RATE_LIMIT_STORE_UNAVAILABLE` (`AuthRateLimitService`) — это
осознанный fail-closed, не баг. Уже выданные access/refresh токены
продолжают работать (проверка сессии идёт через Postgres, не Redis).
Восстановить доступность Redis — единственное действие; никакого
отдельного «аварийного» режима с деградацией безопасности не
предусмотрено намеренно.

## Известные пробелы (честно, не «доделать позже» тихо)

- `PROVIDER_CIRCUIT_OPEN` `SecurityEventType` зарезервирован в схеме,
  но `SmsRuProvider`'s circuit breaker сейчас не пишет это событие при
  открытии — виден только косвенно через рост `unavailable`/`timeout`
  ошибок в логах `sms_ru.request_failed`. Если понадобится точный
  алертинг на открытие circuit breaker'а — нужно прокинуть колбэк из
  `CircuitBreaker.recordFailure()` в `recordSecurityEvent`.
- Реальной очереди для обработки вебхука нет (см.
  `docs/auth/sms-ru-webhook.md`), поэтому throughput вебхуков ограничен
  синхронной обработкой одного HTTP-запроса за раз на пода.
