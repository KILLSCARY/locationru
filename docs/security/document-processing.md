# Проверка загруженного документа (`DocumentProcessingPipelineService`)

## Порядок проверок

`confirmUpload` (и в `DriverDocumentService`, и в `VehicleDocumentService`)
запускает единый пайплайн, шаги строго по порядку — первая неудача
немедленно прерывает обработку:

1. **Скачивание** из `pending/` (`ObjectStorageProvider.downloadObject`).
2. **Размер** — `buffer.length === 0` или больше
   `documents.imageMaxBytes`/`documents.pdfMaxBytes` (в зависимости от
   заявленного MIME) → `SIZE_MISMATCH`.
3. **Магические байты** (`FileTypeDetector.detect`) — сравнение реальной
   сигнатуры файла с тем, что клиент заявил в `mimeType`. Несовпадение →
   `MIME_TYPE_MISMATCH`.
4. **Антивирус** (`MalwareScanner.scan`) — не чистый файл → `MALWARE_DETECTED`.
5. Для PDF — структурная валидация (`PdfProcessor.process`, через
   `pdf-lib`) → `PDF_STRUCTURE_INVALID`, если файл повреждён/не парсится.
   Для изображений — декодирование + очистка EXIF (`ImageProcessor.process`,
   через `sharp`) → `IMAGE_DECODE_FAILED`, если файл не декодируется, затем
   проверка минимальных размеров (`documents.imageMinWidthPx/HeightPx`) →
   `IMAGE_TOO_SMALL`.
6. Генерация превью (`DocumentPreviewGeneratorService`), перемещение в
   `quarantine/` (см. `document-storage.md`).

Любая непредвиденная ошибка на любом из шагов (например, сеть до
хранилища упала) ловится верхним `try/catch` в `process()` и превращается
в `PROCESSING_ERROR` — тоже `FAILED_SECURITY_CHECK`, но с отдельной
метрикой (`document_processing_failed_total`, отличной от
`document_security_failed_total`), чтобы дежурный видел разницу между
"файл реально отклонён" и "у пайплайна что-то сломалось".

## Магические байты (`MagicBytesFileTypeDetector`)

Единственный детектор, разрешённый в staging/production
(`DOCUMENT_FILE_TYPE_DETECTOR=magic-bytes`; `development` — заглушка,
которая всегда пропускает файл, используется только там, где реальные
загрузки не нужны). Явно отклоняет сигнатуры исполняемых файлов и архивов
(`MZ`, ELF, ZIP/Office, RAR, gzip, 7z), даже если заявленный MIME — один из
трёх разрешённых (`image/jpeg`, `image/png`, `application/pdf`), и явно
отклоняет SVG/XML (текстовый формат без байтовой сигнатуры, определяется
сканированием первых непробельных байт после опционального BOM) — SVG
может содержать исполняемый JavaScript, поэтому не входит в список
разрешённых типов вообще, независимо от заявленного MIME.

## Антивирус: development vs. внешний вендор

`DevelopmentMalwareScanner` — всегда возвращает "чисто", используется, когда
`DOCUMENT_MALWARE_SCANNER=development` (в т.ч. в staging — см.
`.env.staging.example`). `ExternalMalwareScanner` — заглушка-заготовка
под реальный вендор (ClamAV, VirusTotal API и т.п.): если
`DOCUMENT_MALWARE_SCANNER` установлен в любое другое значение, а вендор
не подключён, она **явно бросает исключение** с сообщением о том, что
нужно донастроить перед реальными продакшн-загрузками — не притворяется
рабочей проверкой.

## Причина отказа никогда не раскрывается загрузившему

`ProcessingFailureReason` (`SIZE_MISMATCH | MIME_TYPE_MISMATCH |
MALWARE_DETECTED | IMAGE_DECODE_FAILED | IMAGE_TOO_SMALL |
PDF_STRUCTURE_INVALID | PROCESSING_ERROR`) существует только для логов и
метрик. Клиент видит лишь общий статус `FAILED_SECURITY_CHECK` — конкретная
причина никогда не сохраняется на строке документа и не возвращается по
API (Задача 29 явно требует не раскрывать, какая именно проверка сработала,
чтобы не помогать в подборе обхода).

## EXIF/метаданные удаляются, а не просто игнорируются

`SharpImageProcessor` перекодирует изображение (нормализует ориентацию по
EXIF-повороту, затем удаляет весь EXIF, включая GPS/серийные номера
устройства) и возвращает **новый** буфер — именно он, а не оригинал,
уходит в `quarantine/` (см. `document-storage.md`). PDF, наоборот, никак
не трансформируется (только структурно валидируется) — оригинальные байты
копируются как есть, потому что PDF-метаданные не несут аналогичного риска
геолокации устройства.

## Runbook при сбоях пайплайна

См. `docs/runbooks/document-processing-failure.md`.
