# Автомобили водителя

## Модель и статусы

`Vehicle` привязан к `DriverProfile` (`driverId` → `DriverProfile.userId`,
`onDelete: Cascade`). Два независимых статусных поля:

- `VehicleStatus` — `INACTIVE | ACTIVE | BLOCKED | ARCHIVED`. Это
  "выбор водителя, каким автомобилем он сейчас работает" — не имеет
  отношения к проверке документов.
- `VehicleVerificationStatus` — `DOCUMENTS_REQUIRED | SUBMITTED |
UNDER_REVIEW | APPROVED | REJECTED`. Управляется исключительно
  `VerificationSubmissionService`/`VerificationAdminService`, никогда
  напрямую водителем.

Только автомобиль в `ACTIVE` **и** `APPROVED` учитывается
`DriverEligibilityService` как допускающий выход в ONLINE (см.
`eligibility.md`).

## Шифрование регистрационного номера и VIN

Комментарий прямо в `schema.prisma` над моделью `Vehicle`: регистрационный
номер и VIN хранятся **только** зашифрованными (AES-256-GCM через
`DriverDataCryptoService`, тот же паттерн, что и push-токены в Задаче 28,
но с собственным ключевым материалом — `DRIVER_DATA_ENCRYPTION_KEY`/
`DRIVER_DATA_HASH_SECRET`) плюс односторонний HMAC-хэш для проверки
уникальности (шифротекст со случайным IV нельзя сравнивать напрямую).
Наружу (в т.ч. в лог, в API-ответ) уходит только `registrationNumberMasked`
(`••` + последние 4 символа) и `vinLastFour` — то же самое, что видит
пассажир по Задаче 29, раздел 22 (см. `docs/architecture/data-model.md`
и код в `apps/passenger-mobile/app/trip/[id].tsx`/`src/trips/trip.service.ts`
для допустимых полей).

## Ограничение на число автомобилей

`driverVerification.maxActiveVehicles` (по умолчанию 3,
`DRIVER_MAX_ACTIVE_VEHICLES`) — `createVehicle` считает **не-`ARCHIVED`**
автомобили водителя и отказывает (`409 MAX_ACTIVE_VEHICLES_REACHED`) при
достижении лимита. Архивирование — единственный способ "удалить"
автомобиль (`archiveVehicle`, историю документов и заявок он не трогает,
Задача 29 раздел 5 — namespace для истории/аудита не должен исчезать).

## Уникальность регистрационного номера и VIN

Проверяется по хэшу через `assertRegistrationNumberFree`/`assertVinFree` —
`409 REGISTRATION_NUMBER_ALREADY_REGISTERED`/`VIN_ALREADY_REGISTERED`, если
хэш уже занят другим автомобилем (в т.ч. чужого водителя — намеренно:
одна и та же машина не может числиться за двумя водителями одновременно).
`VehicleService.mapUniqueConstraintError` дополнительно ловит `P2002` от
БД (гонка между проверкой и записью) и превращает её в тот же
пользовательский код ошибки, а не в сырое исключение Prisma.

## Повторная проверка при изменении критичных полей

Изменение `brand`/`model`/`productionYear`/`registrationNumber`/`vin` у уже
`APPROVED`-автомобиля переводит его обратно в `UNDER_REVIEW` (сравнение
делается по хэшу для номера/VIN, побайтово — для остальных полей). Цвет,
число мест, наличие детского кресла и т.п. — не критичны, их можно менять
свободно без потери статуса.
