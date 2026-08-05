# Допуск к ONLINE (`DriverEligibilityService`)

## Единственный источник истины

`DriverEligibilityService.evaluateDriverEligibility` — единственное место,
где решается "может ли этот водитель выйти ONLINE прямо сейчас". Каждая
точка, которой нужен этот ответ (`POST drivers/me/online`, дальнейшие
проверки при создании ставки, проверка при логине на предмет саспенда),
вызывает именно этот сервис, а не переизобретает собственные правила —
комментарий об этом прямо в шапке класса.

## `BlockingReason` — 9 значений, любое из которых запрещает ONLINE

| Причина                       | Условие                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `DRIVER_NOT_APPROVED`         | нет `DriverProfile` или `verificationStatus != APPROVED`                                 |
| `ACCOUNT_BLOCKED`             | `User.status != ACTIVE`                                                                  |
| `NO_APPROVED_VEHICLE`         | нет ни одного `Vehicle` с `status=ACTIVE` и `verificationStatus=APPROVED`                |
| `REQUIRED_DOCUMENT_MISSING`   | не у всех обязательных типов есть `ACTIVE`-версия документа со статусом `APPROVED`       |
| `DOCUMENT_EXPIRED`            | обязательный документ водителя просрочен (`expiresAt` в прошлом)                         |
| `VEHICLE_DOCUMENT_EXPIRED`    | то же для документа автомобиля                                                           |
| `LOCATION_PERMISSION_MISSING` | клиент явно сообщил `locationPermissionGranted: false`                                   |
| `ACTIVE_SUSPENSION`           | `verificationStatus = SUSPENDED` (заменяет `DRIVER_NOT_APPROVED`, не добавляется к нему) |
| `CITY_NOT_ACTIVE`             | город водителя не входит в `DRIVER_ACTIVE_CITY_IDS` (если список настроен)               |

`ACTIVE_SUSPENSION` и `DRIVER_NOT_APPROVED` взаимоисключающие — саспенд
проверяется первым и заменяет собой общую "не одобрен", чтобы админ-панель
и клиентские экраны могли показать более точную причину.

Отдельно — `warnings: string[]` (сейчас только
`NOTIFICATION_PERMISSION_WARNING`, если у водителя есть активный push-токен
с `notificationsPermission: false`) — предупреждения никогда не блокируют
ONLINE, только сигнал для UI.

## "ACTIVE-версия" — не то же самое, что "одобрено"

Как и в `documents.md`: `DocumentVersionStatus.ACTIVE` означает "эта версия
сейчас действует в рамках своей семьи", а не "администратор её одобрил".
Сервис явно фильтрует по `DriverDocument.status = APPROVED` /
`VehicleDocument.status = APPROVED` **поверх** фильтра по `ACTIVE`-версии
(комментарий в коде это подчёркивает) — иначе только что загруженный, ещё
не рассмотренный документ ошибочно считался бы допускающим выход на линию.

## `expiresSoon` — предупреждение без блокировки

`documents.expirationWarningDays` (список порогов в днях, например
`[30, 14, 7, 3, 1]`) определяет самое дальнее окно
(`soonestWindowMs = max(...) * 86_400_000`). Если документ истекает внутри
этого окна, но ещё не истёк — `expiresSoon: true` в ответе, ONLINE
по-прежнему разрешён. То же окно использует `DocumentExpirationWorker` для
рассылки предупреждений — см. `document-expiration.md`.

## Проверка на дубли (`DriverDuplicateDetectionService`)

Логически смежная тема — тоже "сигнал, который никогда не решает сам":
`checkForDuplicates` сравнивает хэши (`documentNumberHash` документов
водителя, `vinHash`/`registrationNumberHash` автомобилей, `deviceId` через
`DeviceSession` с ролью `DRIVER`) с данными **всех остальных** водителей.

Классификация (`classify()`):

- `NO_MATCH` — совпадений нет.
- `POSSIBLE_MATCH` — есть совпадение(я), указывающие на единственного
  другого водителя, но по одному сигналу (например только `deviceId`).
- `STRONG_MATCH` — на одного и того же другого водителя указывают **два
  и более** различных типа сигнала одновременно (документ + VIN, или
  документ + device и т.п.) — намеренно устроено так, чтобы никогда не
  срабатывать от одного-единственного совпадения, как того требует Задача
  29 (раздел 20: "никогда не блокировать автоматически по одному сигналу").
- `MANUAL_REVIEW_REQUIRED` — совпадения указывают на **нескольких разных**
  других водителей одновременно — заведомо неоднозначная ситуация, решение
  явно эскалируется человеку, а не угадывается кодом.

Результат никогда не блокирует подачу заявки — только пишется в
`VerificationCase.duplicateCheckResult` и поднимает `priority` кейса до
`HIGH` при `STRONG_MATCH`/`MANUAL_REVIEW_REQUIRED` (см. `verification.md`).
