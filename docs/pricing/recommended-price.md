# Рекомендуемая цена

`POST /api/v1/pricing/estimate` сначала получает серверную оценку маршрута, затем
возвращает расстояние, время, `recommendedPriceKopecks`,
`minimumSuggestedPriceKopecks` и `maximumSuggestedPriceKopecks`. Расчёт:

`baseFare + distanceMeters × perKm / 1000 + durationSeconds × perMinute / 60`.

Все входные значения и результат — целые копейки. Каждая дробная составляющая
округляется до ближайшей копейки, половина округляется вверх. Нижняя и верхняя
границы задаются basis points и округляются тем же правилом; нижняя граница не
может быть меньше `PRICING_MINIMUM_FARE_KOPECKS`.

Настройки: `PRICING_BASE_FARE_KOPECKS`,
`PRICING_PER_KILOMETER_KOPECKS`, `PRICING_PER_MINUTE_KOPECKS`,
`PRICING_MINIMUM_FARE_KOPECKS`, а также нижний и верхний множители в basis
points. Рекомендация не заменяет торги: пассажир может указать свою цену, если
она не ниже существующего системного минимума заказа.
