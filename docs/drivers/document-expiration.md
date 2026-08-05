# Истечение срока действия документов (`DocumentExpirationWorker`)

## Что делает воркер

Фоновый воркер (тот же паттерн опроса по таймеру, что и
`NotificationOutboxWorker` из Задачи 28: `OnModuleInit`/`OnModuleDestroy`,
интервал `DOCUMENT_EXPIRATION_CHECK_INTERVAL_MS`, по умолчанию час),
каждый цикл выполняет три шага:

1. **`processExpiredDriverDocuments`** — документы водителя с `expiresAt` в
   прошлом переводятся в `EXPIRED`; если родительский `DriverProfile` был
   `APPROVED` — тоже переводится в `EXPIRED`. Инкремент
   `document_expired_total`.
2. **`processExpiredVehicleDocuments`** — то же самое для документов
   автомобиля и статуса `Vehicle`.
3. **`processExpiringWarnings`** — для документов, которые истекают в
   пределах ближайшего порога из `documents.expirationWarningDays`
   (`DOCUMENT_EXPIRATION_WARNING_DAYS`, например `30,14,7,3,1`), в
   `NotificationOutboxService` кладётся `DRIVER_DOCUMENT_EXPIRING` с
   идемпотентным ключом `document-expiring:{documentId}:{bucket}` — один и
   тот же документ не получит два одинаковых предупреждения в одном и том
   же окне, даже если воркер отработает несколько раз подряд до следующего
   порога.

## Принудительный уход в OFFLINE

`forceOfflineIfIneligibleAndIdle` — после того, как документ/профиль/
автомобиль переведены в `EXPIRED`, воркер **не изобретает собственную**
логику "значит ли это, что водитель больше не может быть ONLINE" — он
повторно вызывает `DriverEligibilityService.evaluateDriverEligibility` (тот
же единственный источник истины, что и везде — см. `eligibility.md`) и
переводит водителя в `OFFLINE` **только если** у него сейчас нет активной
поездки (`ACTIVE_TRIP_STATUSES` — тот же список статусов, что использует
`findActiveTripId` в `driver.service.ts`). Водитель посреди поездки не
выбрасывается в OFFLINE из-за истёкшего документа — поездка всегда
завершается, а не обрывается сервером.

## Почему это не то же самое, что просто "не пускать на ONLINE"

`DriverEligibilityService` и так отказал бы новому запросу `POST
drivers/me/online` при истёкшем документе (через `DOCUMENT_EXPIRED`/
`VEHICLE_DOCUMENT_EXPIRED`) — но водитель, который **уже** ONLINE в момент
истечения срока, иначе оставался бы ONLINE до следующего собственного
действия. Этот воркер закрывает именно этот разрыв — активный обход всех
уже-ONLINE водителей с истёкшими документами.
