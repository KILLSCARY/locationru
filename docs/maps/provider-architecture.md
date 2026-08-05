# Архитектура карт: провайдер-агностичный слой

Модуль `apps/api/src/maps` инкапсулирует геокодинг, поиск адресов и
маршрутизацию за набором интерфейсов
(`apps/api/src/maps/providers/maps-provider.interface.ts`):

- `GeocodingProvider` — `searchAddress`, `geocodeAddress`, `reverseGeocode`.
- `RoutingProvider` — `buildRoute`, `estimateRoute`.
- `MapMatchingProvider` — `matchLocationToRoad`, `matchRoute`.
- `PlacesProvider` — `searchPlaces`, `getPlaceDetails`.

Публичная бизнес-логика (`MapsService`, `TripService`, контроллеры) зависит
только от этих интерфейсов и от `MapsProvider` (их объединения). Ни один SDK
конкретного поставщика карт не импортируется за пределами
`apps/api/src/maps/providers/*`.

## Выбор провайдера

Провайдер выбирается фабрикой `createMapsProvider`
(`maps-provider.factory.ts`) по конфигурации `MAPS_PROVIDER`:

- `development` — офлайн `DevelopmentMapsProvider`. Работает без сети,
  детерминирован, **запрещён в production** (проверяется дважды: в
  env-валидации и в фабрике).
- `yandex` — боевой адаптер `YandexMapsProvider`. В production обязателен
  `MAPS_API_KEY`; вне production при отсутствии ключа фабрика откатывается на
  `DevelopmentMapsProvider`, чтобы локальная разработка работала без ключа.

Идентификатор провайдера (`provider.name`) сохраняется вместе с результатом —
в кэше (см. `geocoding.md`) и на самой поездке (`trips.routeProvider`), — так
что данные остаются самоописывающими при смене поставщика.

## Fallback

Провайдеры вызываются через `MapsService`, который сам ничего не решает про
конкретный API — он лишь оборачивает провайдер кэшем. Устойчивость к сбоям
живёт в самом адаптере:

- `YandexMapsProvider.buildRoute/estimateRoute` пытается вызвать боевой
  routing-эндпоинт (`fetchRoute`); пока он не подключён (см. `routing.md`),
  запрос детерминированно деградирует к прямой линии с коэффициентом
  извилистости и явным предупреждением в `RouteResult.warnings`, а не падает.
- Геокодинг не имеет offline-фолбэка внутри `YandexMapsProvider` — ошибка
  провайдера (см. ниже) поднимается наверх и превращается в `404`/`5xx` без
  внутренних деталей.

## Ограничения и стоимость запросов

- `DevelopmentMapsProvider` покрывает только 4 фиксированных тестовых адреса
  (см. `geocoding.md`) — этого достаточно для локальной разработки и
  автотестов, но не для реального использования.
- Каждый вызов Yandex Geocoder — платный запрос по счётчику API-ключа.
  Кэширование (TTL `MAPS_GEOCODING_TTL_SECONDS`/`MAPS_SUGGESTIONS_TTL_SECONDS`)
  — основной механизм снижения стоимости; см. `geocoding.md`.
- Устойчивость к сбоям (`ResilientHttpClient` +
  `CircuitBreaker`): таймаут (`MAPS_TIMEOUT_MS`), ограниченное число ретраев
  только для идемпотентных `GET` (`MAPS_MAX_RETRIES`), экспоненциальный
  backoff, нормализация 429/5xx/timeout в `MapsProviderError`, и circuit
  breaker, который открывается после серии сбоев и на время (`openMs`)
  перестаёт бить по недоступному провайдеру.

## Правила хранения ключей

- `MAPS_API_KEY` живёт только в переменных окружения backend'а
  (`.env`/секреты деплоя) и передаётся исключительно из
  `YandexMapsProvider`/`createMapsProvider`.
- Ключ **никогда** не отправляется в мобильные приложения: passenger-mobile и
  driver-android обращаются только к собственным backend-эндпоинтам
  (`/api/v1/maps/*`, `/api/v1/routes/*`), которые не проксируют ключ клиенту.

## Правила переключения провайдера

1. Добавить новый адаптер в `apps/api/src/maps/providers/`, реализующий
   `MapsProvider`.
2. Расширить `MAPS_PROVIDER` в `env.validation.ts` и ветку в
   `createMapsProvider`.
3. Провести конфигурацию нового провайдера через `configuration.ts` (базовый
   URL, ключ, таймауты) — по аналогии с `maps.apiKey`/`maps.apiBaseUrl`.
4. Переключение — это только смена `MAPS_PROVIDER` в окружении; код домена
   (trips, pricing, dispatch) менять не требуется, так как он работает через
   интерфейсы, а не конкретные классы.
