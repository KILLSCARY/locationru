# Архитектура карты в мобильных приложениях

Обе мобильные кодовые базы получают собственный провайдер-агностичный слой
карты — по аналогии с бэкендовым `apps/api/src/maps`
(см. `provider-architecture.md`). Доменная и экранная логика не имеет права
импортировать SDK конкретного поставщика карт напрямую — только интерфейсы
ниже.

## passenger-mobile (`apps/passenger-mobile/src/maps/`)

- `MapAdapter.ts` — контракт для React-компонента карты:
  `MapAdapterProps` (`markers`, `polylines`, `onCameraIdle`,
  `onManualCameraMove`) и `MapAdapterHandle` (императивный `applyCamera`,
  получаемый через `ref`).
- `MapMarker.ts`, `MapPolyline.ts`, `MapBounds.ts` — неизменяемые описания
  маркеров/линий/границ обзора; billder-функции (`pickupMarker`,
  `driverMarker`, `routePolyline`, `traveledPolyline`, `boundsOfPoints` и
  т.д.) вместо прямого создания объектов конкретного SDK.
- `MapCameraController.ts` — конечный автомат камеры: `fitRouteBounds`,
  `focusPoint`, `startFollowingDriver`, `updateDriverPosition`,
  `onManualCameraMove` (отключает автослежение при ручном перетаскивании),
  `resumeFollowing`. Не зависит ни от одного SDK — оперирует только
  геометрией и выдаёт `CameraCommand`, которые применяет `MapAdapterHandle`.
- `MapProviderFactory.ts` — единственное место, которое решает, какой
  React-компонент карты использовать (`getMapView()`), и делает это по
  `EXPO_PUBLIC_MAP_PROVIDER`.

Экраны (`app/trip/new.tsx`, `app/trip/[id].tsx`) работают только через эти
модули и через `MapComponent = getMapView()` — им не известно, отрисовывает
ли текущая сборка `DevelopmentMapView` или боевой SDK.

## driver-android (`core/maps`, `core/maps-yandex`)

- `core/maps` — чистый Kotlin/JVM-модуль (`org.jetbrains.kotlin.jvm`, без
  Android Gradle Plugin и без kapt): `GeoPoint`, `MapMarkerModel`,
  `MapPolylineModel`, `MapBoundsModel`, `CameraCommand` (sealed:
  `FitBounds`/`FocusPoint`/`FollowTarget`), интерфейс `MapProvider` и
  конечный автомат камеры `MapController` — прямой аналог
  `MapCameraController.ts` на Kotlin. Здесь же живут
  `DriverMarkerInterpolator`, `LocationQualityStatus`, `RouteProgress`,
  `RoomSequenceTracker` (см. `location-rendering.md`).
- `core/maps-yandex` — Android-библиотека (`com.android.library`), которая
  реализует `MapProvider` через Yandex MapKit Mobile SDK
  (`YandexMapProvider.kt`). Вынесена в отдельный модуль намеренно: kapt
  (нужен `:app` только для Hilt) не может обработать некоторые классы
  MapKit, скомпилированные под более новый байткод JVM (class file version
  65 против ожидаемой 61) — при попытке объявить их в свойствах/сигнатурах
  kapt-обрабатываемого модуля сборка падает с `UnsupportedClassVersionError`.
  Изоляция в отдельный, kapt-свободный модуль устраняет проблему полностью:
  `:app` лишь ссылается на уже скомпилированный класс `YandexMapProvider`.
- `apps/driver-android/app/.../DriverMap.kt` — единственное место, которое
  решает, использовать ли `YandexMapProvider` или Compose-фолбэк
  `DevelopmentMapView.kt`, — по наличию `BuildConfig.MAPKIT_API_KEY`.

## Выбор SDK и хранение ключей

- **Провайдер**: Yandex MapKit Mobile (`com.yandex.android:maps.mobile:4.42.0-lite`)
  — тот же поставщик, что уже выбран для геокодинга/маршрутизации на бэкенде
  (Задача 24), так что адреса/маршруты и отображение карты используют
  согласованную систему координат и стиль.
- **passenger-mobile**: ключ читается из `EXPO_PUBLIC_MAP_API_KEY` в
  `MapProviderFactory.ts`. В этой поставке реальный биндинг Yandex MapKit для
  React Native **не подключён** — `getMapView()` всегда возвращает
  `DevelopmentMapView`; см. «Известные ограничения» ниже и в финальном
  отчёте.
- **driver-android**: ключ — `MAPKIT_API_KEY`, Gradle-свойство
  (`-PmapkitApiKey=...`) или переменная окружения (тот же секрет, что и в
  `.github/workflows/android-apk.yml`). `DriverApplication.kt` вызывает
  `MapKitFactory.setApiKey(...)` только если ключ не пуст.
- Серверный ключ карт (`MAPS_API_KEY`, backend) **никогда** не передаётся ни
  в одно мобильное приложение — оба клиента обращаются только к
  `/api/v1/maps/*`, `/api/v1/routes/*`.
- Ограничение ключа Yandex MapKit по package name / bundle id / подписи
  приложения настраивается на стороне консоли Yandex (не в коде) — вне
  зоны ответственности этого репозитория; для driver-android ключ выдаётся
  на `applicationId` из `app/build.gradle.kts`.
- **Production без ключа не собирается**: `app/build.gradle.kts` вешает
  Gradle-проверку на задачи `assembleProd*`/`bundleProd*`
  (`afterEvaluate { tasks.matching{...}.configureEach { doFirst { check(...) } } }`)
  — пустой `MAPKIT_API_KEY` останавливает сборку prod-варианта с понятным
  сообщением. Важно: проверка находится в фазе **выполнения** задачи
  (`doFirst`), а не конфигурации — иначе она ломает вообще все варианты
  сборки, включая `devDebug` (так было в первой версии, см. историю
  коммитов).

## DevelopmentMapView / офлайн-фолбэк

Обе платформы имеют полностью автономный (без сети, без SDK) режим отладки:

- **passenger-mobile** — `DevelopmentMapView.tsx`, `memo(forwardRef(...))`
  компонент на `View`/`PanResponder` (одним пальцем — панорамирование, без
  pinch-zoom); рисует сетку, маркеры (цвет/подпись по `MapMarkerKind`),
  линии маршрута и текстовые подписи координат. `applyCamera` сам решает
  масштаб (`fitBounds`/`focusPoint`/`followDriver` — разные константы
  области обзора).
- **driver-android** — `DevelopmentMapView.kt`, Compose `Canvas`: та же
  логика (автоподбор области обзора по маркерам/линиям, сетка, маркеры,
  линии), но через Compose `drawText(textMeasurer, ...)`.

Оба фолбэка достаточны, чтобы пройти любой сценарий Задачи 25 (посадка,
поиск водителя, поездка, потеря сети, GPS-скачок и т.д.) полностью без
настоящего SDK и без ключа — это и есть требование «development fallback
работает без ключа».

**Production-запрет**: на passenger-mobile `MapProviderFactory.ts` бросает
исключение при попытке использовать `DevelopmentMapView` в
production-сборке (`process.env.NODE_ENV === 'production'` и
`EXPO_PUBLIC_MAP_PROVIDER` не задан на реальный SDK); на driver-android —
описанная выше Gradle-проверка на `MAPKIT_API_KEY`.

## Известные ограничения

- Реальный биндинг Yandex MapKit для React Native (passenger-mobile) не
  подключён в этой поставке — `getMapView()` всегда возвращает
  `DevelopmentMapView`. `MapProviderFactory.ts` и `MapAdapter.ts` уже
  описывают контракт, которому обязан соответствовать боевой компонент,
  так что подключение SDK не потребует правок в экранах или в
  `MapCameraController`.
- Внутри driver-android классы `DriverMarkerInterpolator`/
  `LocationQualityStatus` (в `core/maps`) полностью реализованы и покрыты
  тестами, но пока не вызываются ни из одного экрана — у водительского
  приложения ещё нет экранов «в пути к пассажиру» / «поездка выполняется»
  (см. `driver-map-flow.md`), где отображалась бы чужая сглаживаемая
  позиция.
