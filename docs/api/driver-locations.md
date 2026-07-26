# Статус и координаты водителя

Все endpoint'ы требуют Bearer access token пользователя с ролью `DRIVER` и
доступны с префиксом `/api/v1`.

- `POST /drivers/me/online` — переводит одобренного водителя в `ONLINE`.
  Требуется хотя бы один автомобиль со статусом `APPROVED`.
- `POST /drivers/me/offline` — переводит водителя в `OFFLINE` и удаляет live-
  позицию из Redis.
- `GET /drivers/me/status` — возвращает статус проверки, наличие одобренного
  автомобиля и последнюю актуальную позицию.
- `POST /drivers/me/location` — принимает одну точку.
- `POST /drivers/me/location/batch` — принимает `{ "locations": [...] }`.

Одна точка содержит `recordedAt`, `latitude`, `longitude`, `accuracyMeters`,
`provider`, `confidence` и `suspectedSpoofing`; необязательны
`speedMetersPerSecond`, `bearingDegrees`, `altitudeMeters`,
`satellitesVisible`, `cellCount`. Значение `confidence` от клиента сохраняется
как заявленное, но итоговая `confidence` для истории вычисляется сервером по
точности и признаку spoofing.

`deviceId` берётся из аутентифицированной `DeviceSession`, а не из тела
запроса. Поэтому повтор точки с теми же `deviceId + recordedAt` безопасно
дедуплицируется. История находится в Postgres/PostGIS в таблице
`driver_locations`; свежая последняя позиция — в Redis с TTL.

Сервер отклоняет точки из слишком далёкого будущего и точки, которые означают
невозможную скорость относительно последней позиции. Старые точки сохраняются
в истории с признаком `stale`, но не обновляют live-позицию. Ограничение на
размер batch, частоту, будущую дату, устаревание и максимальную скорость
задаются переменными `DRIVER_LOCATIONS_*` в `.env`.
