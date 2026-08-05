# Документы водителя и автомобиля

## Жизненный цикл одного документа

```
UPLOADING → PROCESSING → READY_FOR_REVIEW → (APPROVED | REJECTED | FAILED_SECURITY_CHECK)
                                                         ↓ (новая загрузка того же типа)
                                                    новая версия PENDING_REVIEW
```

`DriverDocumentService`/`VehicleDocumentService` (структурно идентичны — см.
комментарий в заголовке каждого класса про то, почему это не одна общая
generic-база) реализуют четыре HTTP-шага:

1. `POST .../documents/upload-url` — создаёт строку документа в статусе
   `UPLOADING` (или переиспользует «брошенную» `UPLOADING`-строку того же
   `(driverId|vehicleId, type)`, если она уже есть — идемпотентность при
   повторной попытке загрузки) и возвращает presigned PUT-URL от
   `ObjectStorageProvider.createDocumentUploadUrl`. Ключ объекта — всегда
   случайный UUID под префиксом `pending/`, никогда не выводится из имени
   файла клиента (см. `docs/security/document-storage.md`).
2. Клиент грузит байты напрямую в object storage — сервер API их не видит.
3. `POST .../documents/:id/confirm` — проверяет, что объект действительно
   появился в хранилище (`confirmDocumentUpload`), затем прогоняет через
   `DocumentProcessingPipelineService` (см. `document-processing.md`).
   Успех → `READY_FOR_REVIEW` + запись новой `DocumentVersion`. Провал →
   `FAILED_SECURITY_CHECK`, конкретная причина никогда не показывается
   загрузившему (только "отклонён", generic-сообщение).
4. `GET .../documents` (список, без URL — см. ниже) и `GET .../documents/:id`
   (с превью, короткоживущий signed URL).

## Версии документа (`DocumentVersionService`)

Задача 29, раздел 11: повторная загрузка **никогда** не перезаписывает уже
одобренную строку `DriverDocument`/`VehicleDocument` — вместо этого
создаётся новая строка, а `DocumentVersionService` отслеживает, какая из
версий одной "семьи" (`documentFamily` = `driver:{driverId}:{type}` или
`vehicle:{vehicleId}:{type}`) сейчас действует (`ACTIVE`).

- `recordNewVersion` — первая загрузка для семьи сразу становится `ACTIVE`
  (защищать пока нечего). Если `ACTIVE`-версия уже есть — новая версия
  получает `PENDING_REVIEW`, а старая остаётся `ACTIVE` без изменений
  (`isReplacement: true` в возврате).
- Если `isReplacement` истинно и родительский профиль/автомобиль сейчас
  `APPROVED` — `DriverDocumentService.confirmUpload`/
  `VehicleDocumentService.confirmUpload` переводят его обратно в
  `UNDER_REVIEW` (замена ранее одобренного документа требует повторной
  проверки — Задача 29, разделы 3/5/16).
- `activateVersion` (вызывается только из `VerificationAdminService` при
  одобрении документа) помечает предыдущую `ACTIVE`-версию `SUPERSEDED` и
  делает одобренную версию `ACTIVE`.

Важно: `ACTIVE` **не значит** "одобрено" — первая загрузка любого типа
становится `ACTIVE` немедленно, до всякой проверки администратором.
`DriverEligibilityService`/`VerificationSubmissionService` всегда
дополнительно проверяют статус самого документа (`READY_FOR_REVIEW` или
`APPROVED`), а не только факт `ACTIVE`-версии — см. `eligibility.md`.

## Блокировка удаления (`DOCUMENT_LOCKED_UNDER_REVIEW`)

`deleteDocument` отказывает (`409`), если документ в `READY_FOR_REVIEW` и
по водителю есть открытый `VerificationCase` (те же статусы, что и
`OPEN_CASE_STATUSES` в `VerificationSubmissionService`) — иначе документ,
который администратор прямо сейчас смотрит, мог бы исчезнуть у него из-под
рук. `APPROVED`-документ нельзя удалить никогда (замена — только через
новую версию). Всё остальное (`REJECTED`, `FAILED_SECURITY_CHECK`,
`UPLOADING` без открытого кейса) удаляется свободно: строка помечается
`REVOKED`, а фактическое удаление байтов из хранилища откладывается в
`DocumentDeletionQueueEntry` (см. `docs/decisions/driver-legal-requirements.md`
и `document-processing.md`'s ретеншн-раздел — сроки хранения нигде не
решаются кодом, только конфигом + пометкой "требует юридического
подтверждения").

## Что никогда не отдаётся клиенту

`listDocuments` **никогда** не включает URL — только метаданные (тип,
статус, имя файла, причина отклонения). `getDocument`/admin's
`getCaseDetail` отдают `previewUrl` — короткоживущий (60–300 секунд)
подписанный URL на **превью**, не на оригинал; оригинал в `quarantine/`
никогда напрямую не выдаётся ни водителю, ни (кроме превью) администратору.

## Rate limiting

`DocumentUploadRateLimitService` — не более 30 запросов на upload-url в час
на пользователя (Redis, ключ `ratelimit:documentupload:user:{userId}`),
fail-closed: если Redis недоступен — `503`, а не молчаливое отсутствие
лимита (тот же принцип, что у `DeviceTokenRateLimitService` из Задачи 28).
