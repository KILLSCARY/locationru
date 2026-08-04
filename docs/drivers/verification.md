# Верификация водителя — workflow

## Общий поток

```
Регистрация → Заполнение профиля → Добавление автомобиля → Загрузка документов
→ POST /drivers/me/verification/submit → VerificationCase (QUEUED)
→ администратор: assign → start-review (UNDER_REVIEW)
→ approve/reject каждого документа и автомобиля
→ approve-driver | reject-driver | request-changes
→ (если approve-driver) DriverProfile.verificationStatus = APPROVED
→ допуск к ONLINE (через DriverEligibilityService)
```

Нигде в этой цепочке нет автоматического одобрения — единственный путь к
`APPROVED` лежит через `VerificationAdminService.approveDriver`, вызванный
человеком-администратором.

## `VerificationCase` — одна активная заявка на водителя

Модель `VerificationCase` (`prisma/schema.prisma`) хранит `submittedSnapshot`
(замороженный снимок профиля + выбранного автомобиля на момент подачи —
что именно видел администратор, даже если водитель потом изменит профиль),
`duplicateCheckResult` (см. ниже), `assignedAdminId`, `priority`,
`decision`, `decisionReasonCodes`, `publicComment`/`internalComment`.

"Один активный кейс на водителя" реализован на уровне приложения
(`VerificationSubmissionService.submit`, константа `OPEN_CASE_STATUSES =
[CREATED, QUEUED, ASSIGNED, IN_REVIEW, CHANGES_REQUESTED, ESCALATED]`), не
через partial unique index в БД — сознательный компромисс (описан
комментарием прямо в `schema.prisma` рядом с моделью): partial index
потребовал бы отдельной ручной миграции SQL, а приложение и так является
единственной точкой входа для создания кейсов.

### `VerificationCaseStatus` — 9 значений

`CREATED → QUEUED → ASSIGNED → IN_REVIEW → (CHANGES_REQUESTED | APPROVED |
REJECTED | CANCELLED | ESCALATED)`. `CREATED` на практике никогда не
наблюдается снаружи — `VerificationSubmissionService.submit` создаёт кейс
сразу в `QUEUED` (см. ниже, почему). `CANCELLED` зарезервирован, но ни один
код сейчас не переводит кейс в это состояние (нет функции "водитель отозвал
заявку").

## Pre-submission проверки (`POST /drivers/me/verification/submit`)

`VerificationSubmissionService.submit` проверяет по порядку (первая
неудача — немедленный `409 VERIFICATION_NOT_SUBMITTABLE` с
`blockingReasons`):

1. `DriverProfile` существует и `birthDate` заполнен → иначе
   `PROFILE_INCOMPLETE`.
2. Нет уже открытого кейса → иначе `CASE_ALREADY_OPEN`.
3. Для каждого типа из `DRIVER_REQUIRED_DOCUMENT_TYPES` есть активная
   (`DocumentVersion.status = ACTIVE`) версия документа со статусом
   `READY_FOR_REVIEW` или `APPROVED` → иначе
   `REQUIRED_DRIVER_DOCUMENT_NOT_READY`.
4. Хотя бы один (не `ARCHIVED`) автомобиль, у которого **все** типы из
   `VEHICLE_REQUIRED_DOCUMENT_TYPES` готовы → иначе `NO_ELIGIBLE_VEHICLE`.
5. Все обязательные согласия (`REQUIRED_CONSENT_TYPES` в
   `DriverConsentService`) даны и не отозваны → иначе `CONSENT_MISSING`.

Если хотя бы 3-й или 4-й уровень не пройден, но у документа/автомобиля уже
есть _другая_ активная (ещё не отклонённая) версия — проверка всё равно
использует именно ACTIVE-версию, а не голый `status=APPROVED` фильтр по
всей таблице: это принципиально, потому что `DocumentVersionService`
позволяет сосуществовать "ещё не решённой" версии и предыдущей одобренной
(см. `documents.md`, раздел про версии).

## Проверка на дубли — не блокирует подачу

`DriverDuplicateDetectionService.checkForDuplicates` вызывается
**после** прохождения всех pre-submission проверок, но результат никогда не
мешает подаче — только пишется в `VerificationCase.duplicateCheckResult`
(видно администратору через `GET admin/verification/cases/:caseId`) и
поднимает `priority` кейса до `HIGH`, если результат `STRONG_MATCH` или
`MANUAL_REVIEW_REQUIRED`. Подробности классификации — см. отдельный раздел
в `docs/drivers/eligibility.md` (Duplicate-detection логически относится к
той же группе "не даём коду принимать решения о человеке единолично").

## Очередь администратора и одно назначение

`VerificationAdminService.listQueue` — кейсы в статусах `CREATED, QUEUED,
ASSIGNED, IN_REVIEW, ESCALATED` (константа `QUEUE_STATUSES`), сортировка по
`priority desc, createdAt asc`. `assign` может либо самоназначить кейс
(`assigneeAdminId` не передан), либо переназначить (супервизор может
перекинуть кейс другому админу в любой нетерминальной стадии).
`start-review` требует, чтобы кейс уже был назначен именно вызывающему
администратору (`assertAssignedTo`) — иначе `403
CASE_NOT_ASSIGNED_TO_YOU`. Это же ограничение действует на **все**
остальные решающие действия (approve/reject документа, автомобиля,
водителя, request-changes) — кейс не может решить кто угодно, только тот,
кому он назначен.

## 11 действий администратора

`POST admin/verification/cases/:caseId/...`:

| Действие                     | Метод сервиса                     | Эффект                                                                          |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| assign                       | `assign`                          | назначает кейс себе/другому админу                                              |
| start-review                 | `startReview`                     | ASSIGNED → IN_REVIEW, профиль/авто → UNDER_REVIEW                               |
| approve-document             | `approveDocument('DRIVER', ...)`  | документ → APPROVED, версия активируется                                        |
| reject-document              | `rejectDocument('DRIVER', ...)`   | документ → REJECTED, требуется `reasonCode`, комментарий обязателен для `OTHER` |
| approve-vehicle-document     | `approveDocument('VEHICLE', ...)` | то же для документа автомобиля                                                  |
| reject-vehicle-document      | `rejectDocument('VEHICLE', ...)`  | то же                                                                           |
| approve-vehicle              | `approveVehicle`                  | требует, чтобы ВСЕ обязательные документы автомобиля были APPROVED              |
| reject-vehicle               | `rejectVehicle`                   | Vehicle → REJECTED                                                              |
| approve-driver               | `approveDriver`                   | финальное решение — см. ниже                                                    |
| reject-driver                | `rejectDriver`                    | финальное решение — см. ниже                                                    |
| request-changes              | `requestChanges`                  | DriverProfile/Case → CHANGES_REQUESTED                                          |
| escalate                     | `escalate`                        | Case → ESCALATED, priority → HIGH                                               |
| suspend (не кейс-специфично) | `suspendDriver`                   | только для уже APPROVED водителя                                                |

(В таблице 13 строк, а не 11, потому что документ/автомобиль-approve и
reject считаются в исходной задаче двумя парами одного действия —
"approve-document"/"reject-document" один раз для водителя, один раз для
автомобиля.)

## `approveDriver` — единственная точка "все условия выполнены"

Транзакционно проверяет: (а) каждый тип из
`requiredDriverDocumentTypes` имеет `DriverDocument.status = APPROVED`;
(б) автомобиль, зафиксированный в `submittedSnapshot.vehicleId`, имеет
`verificationStatus = APPROVED`. Если хоть одно условие не выполнено — `409
DRIVER_NOT_APPROVABLE` со списком недостающих типов, транзакция не
начинается. Если выполнено — одной транзакцией: `DriverProfile.APPROVED` +
`approvedAt`, `VerificationCase.APPROVED` + `decision` + `completedAt`,
запись в `AdminAuditLog`. После коммита (уже вне транзакции): метрика
`driver_verification_approved_total`, `driver_verification_duration_seconds`,
обновление `verification_queue_size`, push
`DRIVER_ACCOUNT_APPROVED` (через существующий `NotificationOutboxService` —
тот же механизм, что и все остальные push в системе).

## `CHANGES_REQUESTED` — известный пробел с push

Для `request-changes` в схеме `NotificationType` **нет** отдельного push-типа
(есть только `DRIVER_ACCOUNT_APPROVED`/`DRIVER_ACCOUNT_REJECTED`) — водитель
узнаёт об изменении статуса и комментарии только через `GET
drivers/me/profile`, push не отправляется. Добавление отдельного типа —
изменение схемы (`NotificationType` enum + шаблон в
`NotificationTemplateService`), сознательно вынесено за рамки этой задачи.

## "Административное уведомление" о новой заявке

В системе нет push-канала для администраторов (`NotificationType`
поддерживает только `application: DRIVER | PASSENGER`). Появление кейса в
очереди (`status: QUEUED`) — единственный сигнал; администратор должен
опрашивать `GET admin/verification/cases` (или UI должен поллить его).
Это осознанное решение по объёму задачи, не забытая часть — см. итоговый
отчёт Задачи 29.
