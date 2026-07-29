# Рекомендованная цена поездки

`PricingEstimateService` (`apps/api/src/maps/pricing/pricing-estimate.service.ts`)
считает **рекомендацию**, а не финальный тариф: пассажир видит диапазон, но
может предложить свою цену, если она не ниже `minimumSuggestedPriceKopecks`
(проверка минимальной цены поездки остаётся отдельной ответственностью
`TripService`/`trips.minPassengerPriceKopecks`).

## Формула

```
distanceCost   = floor(distanceMeters * perKilometerKopecks / 1000)
durationCost   = floor(durationSeconds * perMinuteKopecks / 60)
recommended    = max(baseFare + distanceCost + durationCost, minimumFare)
minSuggested   = max(floor(recommended * lowerMultiplierBasisPoints / 10000), minimumFare)
maxSuggested   = max(recommended, floor(recommended * upperMultiplierBasisPoints / 10000))
```

Все величины — целые копейки; умножение всегда идёт до деления, результат
округляется вниз (`Math.floor`), поэтому копейка никогда не «плывёт» из-за
чисел с плавающей точкой. `distanceMeters`/`durationSeconds` на входе
усекаются до неотрицательных целых защитно (`Math.max(0, Math.trunc(...))`).

## Конфигурация (`PRICING_*`)

| Переменная                              | Назначение                                       |
| --------------------------------------- | ------------------------------------------------ |
| `PRICING_BASE_FARE_KOPECKS`             | Базовая посадка                                  |
| `PRICING_PER_KILOMETER_KOPECKS`         | Цена за километр                                 |
| `PRICING_PER_MINUTE_KOPECKS`            | Цена за минуту                                   |
| `PRICING_MINIMUM_FARE_KOPECKS`          | Абсолютный минимум рекомендации и нижней границы |
| `PRICING_LOWER_MULTIPLIER_BASIS_POINTS` | Нижняя граница диапазона, в б.п. от recommended  |
| `PRICING_UPPER_MULTIPLIER_BASIS_POINTS` | Верхняя граница диапазона, в б.п. от recommended |

## Эндпоинт

`POST /api/v1/pricing/estimate` (требует Bearer-токен) принимает один из
двух вариантов:

- `{ distanceMeters, durationSeconds }` — уже посчитанные величины (обычно
  из `POST /api/v1/routes/estimate` на клиенте);
- `{ route: { origin, destination, waypoints?, ... } }` — сервер сам вызовет
  `MapsService.estimateRoute` и посчитает цену от результата.

Если не передано ни то, ни другое — `400 DISTANCE_OR_ROUTE_REQUIRED`.
Ответ — `PricingEstimate`: `recommendedPriceKopecks`,
`minimumSuggestedPriceKopecks`, `maximumSuggestedPriceKopecks`,
`distanceMeters`, `durationSeconds`.

## Связь с созданием поездки

`TripService.create` **не доверяет** расстоянию/времени от клиента: маршрут
всегда строится заново на сервере (`MapsService.buildRoute`) из
pickup/destination/stops, и именно эти серверные значения сохраняются на
`trips.estimatedDistanceMeters`/`estimatedDurationSeconds`/`route`. Цена,
которую называет пассажир (`passengerPriceKopecks`), остаётся отдельным
полем — `pricing/estimate` лишь подсказывает разумный диапазон до создания
поездки, но не подменяет собой цену, которую в итоге примет водитель.
