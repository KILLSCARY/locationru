# Selected trip lifecycle

All mutating lifecycle endpoints require an `Authorization: Bearer` access token and an `Idempotency-Key` header. Repeating an endpoint with the same key returns the recorded transition result. Each accepted action is written to `trip_lifecycle_actions`; every status change is also retained in `trip_status_history`.

1. The selected driver calls `POST /api/v1/driver/trips/{tripId}/confirm-departure` (`DRIVER_SELECTED` → `PAYMENT_PENDING`).
2. The passenger calls `POST /api/v1/trips/{tripId}/payment/authorize` (`PAYMENT_PENDING` → `PAYMENT_RESERVED`). The in-process test provider records a reservation.
3. The selected driver calls `POST /api/v1/driver/trips/{tripId}/en-route` (`PAYMENT_RESERVED` → `DRIVER_EN_ROUTE`) and `POST /api/v1/driver/trips/{tripId}/arrived` (`DRIVER_EN_ROUTE` → `DRIVER_ARRIVED`).
4. The passenger requests a one-time boarding code at `GET /api/v1/trips/{tripId}/boarding-code`. The database contains only a SHA-256 hash. The driver submits it to `POST /api/v1/driver/trips/{tripId}/start` with `{ "code": "1234" }`, moving the trip to `IN_PROGRESS`.
5. The driver calls `POST /api/v1/driver/trips/{tripId}/complete`. The test provider captures the existing reservation, producing `IN_PROGRESS` → `COMPLETED` → `SETTLED`.

The boarding-code lifetime and maximum attempts are configured through `TRIPS_BOARDING_CODE_TTL_SECONDS` and `TRIPS_BOARDING_CODE_MAX_ATTEMPTS`.
