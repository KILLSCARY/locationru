# Хранение документов водителя

## Префиксы объектов

`ObjectStorageProvider` (`s3-object-storage.provider.ts`, S3-совместимое
хранилище) работает с тремя логическими префиксами внутри одного бакета:

- `pending/{driverId|vehicleId}/{uuid}.{ext}` — куда клиент грузит файл
  напрямую по presigned PUT URL. Ключ **всегда** случайный UUID,
  сгенерированный сервером (`extensionForMimeType` только выбирает
  расширение) — никогда не производится из имени файла клиента (см.
  `document-filename.util.ts`, `sanitizeAndValidateFileName` используется
  только для отображаемого имени, не для ключа).
- `quarantine/{...}` — куда файл переезжает после успешного прохождения
  `DocumentProcessingPipelineService` (см. `document-processing.md`).
  Копия (не оригинал) — для изображений это **очищенный от EXIF**
  буфер, для PDF — байт-в-байт тот же файл, что и в `pending/`
  (`moveToQuarantine`, копирование + удаление исходного).
- `verified/{...}` — зарезервированный префикс.
  `ObjectStorageProvider.moveToVerifiedStorage` реализован
  (copy `quarantine/` → `verified/` + удаление исходного), но **ни один**
  сервис его сейчас не вызывает: `VerificationAdminService.approveDocument`
  меняет только статус строки в БД (`DocumentStatus.APPROVED`), файл
  физически остаётся в `quarantine/`. Это осознанный пробел объёма задачи,
  а не забытый вызов — см. финальный отчёт Задачи 29. Логика перемещения
  уже на месте на случай, если позже понадобится физически разделить
  "на рассмотрении" и "одобрено" на уровне хранилища (например для более
  строгих прав доступа к бакету).

## Presigned URL — единственный способ передачи байтов

API-процесс никогда не видит содержимое файла напрямую: `createUploadUrl`/
`createDocumentUploadUrl` отдают клиенту presigned `PUT`, а
`confirmDocumentUpload`/`getObjectMetadata` только спрашивают у хранилища
метаданные (`HeadObjectCommand`) — размер и MIME, не байты. Байты читаются
сервером ровно один раз — внутри `DocumentProcessingPipelineService.process`
(`downloadObject`), для магических байт/malware/размерности проверки.
Ссылки на скачивание (`createSecureDownloadUrl`) — короткоживущие
(`DOWNLOAD_SHORT_TTL_SECONDS` = 60 у водителя,
`PREVIEW_URL_TTL_SECONDS` = 300 у администратора) и выдаются только на
**превью**, не на оригинал (см. `documents.md`).

## Шифрование метаданных документа

Номер документа (паспорт, ВУ и т.п.), если он вообще извлекается —
задача 29 явно **не** включает автоматическое OCR/распознавание, так что
на практике `documentNumberEncrypted`/`documentNumberHash` заполняются
только тем, что явно передал сам driver-android клиент, если/когда такое
поле появится в форме загрузки. Хранится тем же паттерном, что и
регистрационный номер автомобиля (`docs/drivers/vehicles.md`) —
AES-256-GCM + HMAC-хэш для дублей, никогда plaintext.

## Retention и удаление

`DocumentDeletionQueueEntry` — очередь на **отложенное** физическое
удаление (см. `docs/decisions/driver-legal-requirements.md`,
`document-processing.md`). Никакая часть системы не удаляет объект
из хранилища немедленно по запросу пользователя — всегда через очередь с
`eligibleAt` в будущем (`documents.pendingRetentionHours`,
по умолчанию 24 часа) и с возможностью юридической приостановки
(`legal hold`, `DocumentRetentionAdminService`) — механизм, не решение о
сроках: точные сроки хранения нигде не закодированы как окончательные,
только как инженерная заглушка, ожидающая подтверждения юриста/DPO.
