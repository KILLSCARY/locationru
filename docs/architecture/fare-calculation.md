# Расчёт стоимости и комиссии

Все денежные значения хранятся и рассчитываются как целое количество копеек.
Процент комиссии хранится в basis points: `800` означает `8%`, то есть
`800 / 10000` от суммы.

`FareCalculator` выбирает ставку комиссии в таком порядке:

1. `DriverProfile.commissionBasisPoints`, если задана индивидуальная ставка;
2. `CityCommissionRate` для `Trip.cityCode`;
3. `FINANCE_GLOBAL_COMMISSION_BASIS_POINTS`.

Правило округления: процентная комиссия считается как
`floor(totalKopecks * basisPoints / 10000)` — всегда вниз до целой копейки.
Затем применяется `FINANCE_MIN_COMMISSION_KOPECKS`, а окончательная комиссия
ограничивается суммой поездки. Поэтому `commissionKopecks + driverPayoutKopecks`
всегда точно равны `totalKopecks`.

При выборе предложения результат расчёта (`finalPriceKopecks`,
`commissionBasisPoints`, `commissionKopecks`, `driverPayoutKopecks`) записывается
в `Trip` в той же транзакции. Последующие изменения глобальной, городской или
индивидуальной настройки не меняют уже созданную поездку. Реальная платёжная
система на этом этапе не подключается.
