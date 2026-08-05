# Маршруты

## Эндпоинты

- `POST /api/v1/routes/estimate` `{ origin, destination, waypoints?,
transportMode?, avoidTolls?, avoidUnpavedRoads? }` — возвращает
  `distanceMeters`, `durationSeconds`, `bounds`, `provider` (без полной
  геометрии — дешевле для UI, которому нужны только числа).
- `POST /api/v1/routes/build` — тот же запрос, полный `RouteResult` с
  геометрией (`geometry`, `encodedPolyline`), `bounds`, `snappedWaypoints`,
  `warnings`.

Оба защищены `AccessTokenGuard` и Redis rate-limit
(`MAPS_ROUTES_RATE_LIMIT_PER_MINUTE`, по умолчанию 30/мин на пользователя).
`waypoints` — до 10 точек с полем `sequence` (порядок промежуточных остановок).

## Кэширование

`routeCacheKey` (`apps/api/src/maps/geo/cache-keys.ts`) кладёт в ключ:
origin, destination, отсортированные по `sequence` waypoints,
`transportMode`, `avoidTolls`, `avoidUnpavedRoads` и отдельно —
`estimate`/`build`, так как это разные результаты (build дороже и хранит
геометрию). TTL — `MAPS_ROUTE_TTL_SECONDS` (по умолчанию 1800 с): маршруты
дешевле кэшировать ненадолго, чем геокодинг, потому что зависят от опций
поездки, а не только от точки на карте.

## DevelopmentMapsProvider: детерминированный тестовый маршрут

`DevelopmentMapsProvider.buildRoute`/`estimateRoute` не ходят в сеть:

- геометрия — интерполяция между origin → waypoints → destination (8 точек
  на сегмент), гарантированно ≥ 2 точки;
  дистанция — длина ломаной по прямой (`polylineLengthMeters`), умноженная
  на коэффициент извилистости 1.3 (дороги длиннее воздушной линии), с полом
  100 м;
- длительность — расстояние делённое на среднюю скорость (8.5 м/с для
  `driving`, в 6 раз медленнее для `walking`);
- результат детерминирован: одинаковый запрос → побитово одинаковый
  `RouteResult` (проверено тестом).

## Реальный адаптер: Yandex

`YandexMapsProvider` (`apps/api/src/maps/providers/yandex-maps.provider.ts`)
использует Yandex Geocoder HTTP API для геокодинга/поиска. Для самого
построения маршрута — как и в существующей заготовке dispatch
(`HttpRouteEstimator`) — конкретный routing-API ещё не подключён:
`fetchRoute` — точка расширения, где нужно вызвать выбранный routing-сервис
(Yandex Router API/аналог) и вернуть геометрию с покрытием дорог. Пока он не
подключён, `buildRoute`/`estimateRoute` детерминированно деградируют к
прямой линии (тот же коэффициент извилистости 1.3, скорость 8.5 м/с) и
добавляют предупреждение в `RouteResult.warnings`, а не падают — так же, как
`HttpRouteEstimator` в dispatch деградирует к straight-line ETA при
недоступности маршрутного API.

## Устойчивость

Все HTTP-вызовы идут через `ResilientHttpClient`
(`apps/api/src/maps/providers/resilient-http-client.ts`):

- таймаут `MAPS_TIMEOUT_MS` на попытку;
- ретраи — только для `GET` (геокодинг/поиск), не более
  `MAPS_MAX_RETRIES`, с экспоненциальным backoff (100 мс, 200 мс, …);
  `POST` (построение маршрута) никогда не ретраится, чтобы не задваивать
  небезопасный запрос;
- `429`/`503` → `MapsProviderError('rate_limited')`, `5xx` →
  `unavailable`, невалидный JSON/4xx → `invalid_response` (не ретраится);
- `User-Agent` передаётся на каждый запрос (`MAPS_USER_AGENT`);
- `CircuitBreaker` (`circuit-breaker.ts`) открывается после 5 подряд
  неудач и на 30 с перестаёт пропускать запросы к провайдеру
  (`circuit_open`), затем пробует один запрос в half-open — успех закрывает
  цепь, неудача открывает её снова.
