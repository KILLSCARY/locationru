# Профиль водителя

## Модель `DriverProfile`

`userId` — основной внешний ключ на `User` (не отдельный auto-increment id;
`DriverProfile.id` — отдельный синтетический UUID, добавлен только потому,
что Prisma требует `@id`, но всё остальное в системе ссылается на профиль
через `userId`, не через `id` — см. обоснование в комментарии схемы и в
итоговом отчёте Задачи 29). Поля: `firstName`, `lastName`, `middleName?`,
`birthDate`, `phone` (всегда зеркало `User.phone`, никогда не редактируется
через профиль напрямую), `email?`, `cityId`, `verificationStatus`,
`operationalStatus`, `profilePhotoObjectKey?`, метки времени
`submittedAt/approvedAt/rejectedAt/suspendedAt`, `verificationComment?`,
`version` (оптимистичная блокировка на будущее, сейчас не используется для
конфликт-резолюции — просто инкрементируется при каждом апдейте).

## `DriverVerificationStatus` — 10 значений

`NOT_STARTED → PROFILE_INCOMPLETE → DOCUMENTS_REQUIRED →
DOCUMENTS_SUBMITTED → UNDER_REVIEW → (CHANGES_REQUESTED | APPROVED |
REJECTED) → SUSPENDED / EXPIRED`.

- `NOT_STARTED` — виртуальное значение: строки `DriverProfile` ещё не
  существует (`DriverProfileService.getMyProfile` возвращает его синтетически,
  не читая из БД).
- `PROFILE_INCOMPLETE` — профиль создан (`DriverProfileService.upsertProfile`
  на первом вызове), но документы ещё не загружены.
- `DOCUMENTS_REQUIRED` — фактически то же самое, что `PROFILE_INCOMPLETE` в
  текущей реализации: отдельного перехода в `DOCUMENTS_REQUIRED` нет, это
  значение зарезервировано схемой, но код никогда явно в него не переводит
  (известный пробел, см. итоговый отчёт).
- `DOCUMENTS_SUBMITTED` — выставляется `VerificationSubmissionService.submit`
  сразу после успешного прохождения всех pre-submission проверок.
- `UNDER_REVIEW` — выставляется `VerificationAdminService.startReview`, когда
  назначенный администратор фактически начинает разбор кейса (не в момент
  подачи заявки).
- `CHANGES_REQUESTED` / `APPROVED` / `REJECTED` — терминальные решения
  администратора (`VerificationAdminService.requestChanges/approveDriver/rejectDriver`).
- `SUSPENDED` — отдельное действие `VerificationAdminService.suspendDriver`,
  применимо только к уже `APPROVED` водителю, не связано с конкретным кейсом.
- `EXPIRED` — выставляется `DocumentExpirationWorker`, когда истёк срок
  действия одобренного документа (см. `document-expiration.md`).

## `DriverOperationalStatus` — отдельно от `verificationStatus`

`OFFLINE / ONLINE / BUSY / BLOCKED` — это состояние "готов ли водитель принимать
заказы прямо сейчас", полностью независимое от того, одобрен ли он в принципе.
Переключается через `DriverService.goOnline/goOffline`
(`apps/api/src/drivers/driver.service.ts`), но фактическое разрешение перейти
в `ONLINE` всегда проверяется через `DriverEligibilityService` — см.
`eligibility.md`. `BLOCKED` в этом enum ещё не используется ни в одном месте
кода (зарезервировано на будущее для принудительной блокировки конкретной
смены администратором, отдельно от `SUSPENDED`).

## Критичные поля и повторная проверка

`DriverProfileService.upsertProfile` сравнивает `firstName/lastName/
middleName/birthDate/cityId` (константа `CRITICAL_FIELDS`) со значениями,
уже сохранёнными в БД. Если что-то из этого списка изменилось **и**
`verificationStatus` на момент вызова был `APPROVED` — профиль немедленно
переводится в `UNDER_REVIEW` тем же вызовом (без создания нового
`VerificationCase` — старый кейс уже закрыт, новый кейс появится только
когда водитель снова вызовет `POST /drivers/me/verification/submit`).
`phone` **не входит** в этот список: оно вообще не принимается через тело
запроса, всегда берётся из `User.phone` в самом сервисе — клиент не может
подменить телефон через профиль (единственный способ сменить телефон —
отдельный, ещё не реализованный, flow смены номера с OTP-подтверждением
обоих номеров).

## Возраст

`DriverProfileService.parseAndValidateBirthDate` проверяет три вещи: дата
парсится, дата не в будущем, возраст (`calculateAge`, учитывает точный
день/месяц, а не только год) не меньше `DRIVER_MINIMUM_AGE` (18 по
умолчанию) и не больше 100 лет (защита от опечатки, не юридическое
ограничение). Само значение 18 — **не юридический вывод**, см.
`docs/decisions/driver-legal-requirements.md`, §2.

## Эндпоинты

`GET /drivers/me/profile`, `PUT /drivers/me/profile` — оба защищены
`@Roles('DRIVER')`. `PUT` идемпотентен по смыслу (upsert): первый вызов
создаёт профиль (`verificationStatus: PROFILE_INCOMPLETE`), последующие —
обновляют существующий с `version: {increment: 1}`.

## Известные пробелы

- `DOCUMENTS_REQUIRED` не используется как отдельный переходный статус (см.
  выше) — на практике это не создаёт функциональной проблемы (следующий
  реальный статус, `DOCUMENTS_SUBMITTED`, требует ровно тех же
  предусловий), но нарушает точную семантику enum, описанную в задаче.
- Нет отдельного flow смены номера телефона с переносом истории профиля —
  `phone` синхронизируется с `User.phone` только на чтение/запись профиля,
  но ничего не инициирует такую синхронизацию, если номер меняется где-то
  ещё (сейчас нигде не меняется после регистрации).
