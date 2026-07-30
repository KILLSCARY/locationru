# Карта водительского приложения

`DriverMap` (`apps/driver-android/app/.../DriverMap.kt`) — единственная
точка входа: по наличию `BuildConfig.MAPKIT_API_KEY` выбирает
`YandexMapProvider` (боевой SDK, `core/maps-yandex`) или
`DevelopmentMapView` (Compose Canvas, без SDK) и создаёт для выбранного
провайдера `MapController` (`core/maps`) — экраны работают только с
`MapController`/`MapMarkerModel`/`MapPolylineModel`, не с конкретным SDK.

## Экран доступных заказов (`WorkspaceScreen`, `MainActivity.kt`)

Единственный экран, полностью подключённый к карте на сегодня:

- позиция водителя (заглушка — своя геолокация не наносится вручную, её
  показывает собственный слой «моё местоположение» карты; водителю не
  требуется сглаживание собственных координат, только чужих);
- точки подачи всех доступных заказов — маркеры
  `MapMarkerKind.ORDER_CANDIDATE` в `orderMarkers`
  (`remember(state.orders) { state.orders.map { MapMarkerModel(...) } }`),
  координаты берутся из `AvailableTripResponse.pickupLatitude/pickupLongitude`
  (добавлены в Задаче 25 — раньше DTO их не содержал);
  Yandex/DevelopmentMapView. `TripCard` уже показывает адрес назначения,
  расстояние и ETA (карточка, не сама карта).
- `LaunchedEffect(mapController, orderMarkers)` подгоняет область обзора
  под все точки подачи (`mapController.fitRouteBounds(MapBoundsModel.of(...).padded(0.3))`),
  когда список заказов не пуст.
- **Точный адрес назначения до принятия заказа**: `TripCard` уже
  показывает `destinationAddress`, приходящий в `AvailableTripResponse` —
  это существующее поведение бэкенда (не изменено в Задаче 25), сохранено
  как есть согласно указанию «если текущая логика уже раскрывает адрес —
  не меняй».

## Экран «в пути к пассажиру» и «поездка выполняется» — не реализованы

`DriverUiState` (`DriverWorkspaceViewModel`) содержит только состояния
`Restoring` / `PhoneEntry` / `CodeEntry` / `Workspace` — после принятия
заказа (`bid.accepted`) экранная машина состояний не переключается ни во
что новое, водительское приложение не имеет собственных экранов
«еду к пассажиру» (маршрут до точки подачи, кнопка «Прибыл», активная
только рядом с точкой подачи — проверка близости на бэкенде) и «поездка
идёт» (маршрут до назначения, живая позиция, сохранение маршрута локально,
очередь точек геолокации при потере сети).

Это осознанное сокращение объёма, а не недосмотр: чтобы отобразить
что-либо на этих экранах, сперва нужна сама экранная машина состояний
после принятия заказа, которой в водительском приложении не было **до**
Задачи 25 — построение её с нуля (навигация между экранами, ViewModel,
интеграция с существующими эндпоинтами `/driver/trips/:id/en-route`,
`/arrived`, `/start`, `/complete`) вышло за рамки данной итерации, сфокусированной
на карте. Всё, что нужно этим будущим экранам, уже готово и протестировано
в `core/maps`:

- `MapController` — подходит без изменений (тот же конечный автомат
  камеры, что и на `WorkspaceScreen`);
- `DriverMarkerInterpolator`, `LocationQualityStatus`, `RouteProgress`,
  `RoomSequenceTracker` — реализованы, покрыты юнит-тестами
  (`DriverMarkerInterpolatorTest.kt`, `LocationQualityStatusTest.kt`,
  `RouteProgressTest.kt`, `RoomSequenceTrackerTest.kt`), но пока не
  вызываются ни из одного экрана;
- `DevelopmentMapView.kt`/`YandexMapProvider.kt` не требуют доработки —
  им всё равно, какой экран их использует.

Когда экраны появятся, их подключение к карте — это, по сути, повторение
структуры `WorkspaceScreen`: собрать `MapMarkerModel`/`MapPolylineModel` из
состояния экрана, передать в `DriverMap(markers=..., polylines=...)`,
обновлять камеру через `MapController` по мере поступления WS-событий
(`driver.location.updated` уже не нужен — это собственная позиция;
понадобится `trip.updated`/`driver.arrived`/`trip.started` для смены
состояния экрана).
