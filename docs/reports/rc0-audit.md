# RC0 technical audit — Resilient Taxi

Date: 2026-07-27

## Scope and method

The audit covered `apps/api`, `apps/admin-web`, `apps/passenger-mobile`,
`apps/driver-android`, workspace packages, Prisma migrations, Compose files and
the documentation. A separate checkout at `C:\tmp\resilient-taxi-rc0-audit`
was created from the committed repository for Node dependency installation and
build checks. The local machine has no `docker` executable, therefore Compose,
PostgreSQL, Redis and database-backed checks are **not passed** rather than
treated as successful.

## Inventory

### Implemented server modules

- Nest bootstrap, strict TypeScript, configuration validation, global
  `ValidationPipe`, JSON logging, API error filter, graceful shutdown,
  `/api/v1` prefix and development-only Swagger.
- Health checks for PostgreSQL and Redis.
- Prisma data model and migrations for users, profiles, vehicles, sessions,
  trips, stops, status history, locations, dispatch, bids, financial records,
  realtime outbox and administrative audit log.
- OTP authentication, session revocation, refresh-token rotation, role guards
  and Redis-backed OTP/rate limiting.
- Passenger trip creation/search/cancellation, PostGIS locations, dispatch,
  bidding, fare calculation, trip state machine and outbox-backed WebSocket
  gateway.
- Administrative API and minimal Next.js administrative UI.

### Partially implemented modules

- `packages/contracts` has Zod schemas and tests, but is not imported by either
  client application. The passenger app defines duplicate REST types in
  `src/api/types.ts`; Android has independent Kotlin DTOs. They are not
  generated from the public contract.
- The lifecycle module uses `TripPayment` and `TestPaymentProvider`; the newer
  `PaymentIntent`/`PaymentTransaction`/`CommissionRecord`/`DriverPayout`
  architecture is not called by lifecycle endpoints. A settled trip therefore
  has no proven ledger/payout path.
- Admin UI has basic views and action confirmation, but no automated UI/API
  authorization tests.
- Passenger and admin packages have zero package-level tests. Android has a
  small unit-test set, but no end-to-end device/API coverage.
- `docs/geo` and `docs/payments` contain only placeholders. The dispatch
  document states direct-distance routing is temporary.

### Development and mock implementations

- `DevelopmentSmsProvider` logs OTP only outside production.
- `DevelopmentPaymentProvider` is an in-memory deterministic PSP simulator and
  rejects production startup.
- `TestPaymentProvider` is the lifecycle in-process reservation/capture mock.
  It now rejects production startup too.
- Existing HTTP lifecycle e2e test replaces `TripLifecycleService` with a
  stub; it validates routing, not persistence, payment ledger or WebSocket
  delivery.

### Missing integrations

- Real SMS, payment, payout, webhook transport and routing providers.
- Production-safe lifecycle-to-payment-ledger integration.
- Generated or shared mobile client contracts.
- A real database/WebSocket full-flow test, operational Docker runtime, CI
  workflow and complete geo/payment documentation.

### Code hygiene inventory

- `TODO`/`FIXME` scan found no product-code markers. Matches inside `.git`
  sample hooks were excluded; `XXX` in `pnpm-lock.yaml` was an integrity hash.
- No commented-out executable code was found; the few block comments document
  runtime behavior.
- No committed `.env` or literal production secret was found. `.env.example`
  contains placeholders. This is a source scan, not a secret-manager audit.
- No Prisma type is exported from `packages/contracts`; Prisma imports remain
  internal to API code.
- `$queryRawUnsafe` is used in trips, dispatch, bids and locations. The audited
  calls use static SQL with positional parameters; no user value is interpolated
  into SQL text. Keeping this API requires review discipline.

## Findings

### CRITICAL

1. **No real full server scenario test exists.** The requested passenger →
   driver → bid → payment → settlement scenario, status history, ledger and
   WebSocket checks is not automated against PostgreSQL/Redis. The existing
   lifecycle e2e test stubs the lifecycle service. This must be implemented and
   run against disposable PostGIS/Redis before staging.

2. **The payment ledger is disconnected from the lifecycle.** The lifecycle
   writes `TripPayment` through `TestPaymentProvider`; it does not create or
   capture `PaymentIntent`/`PaymentTransaction`, create a `CommissionRecord`,
   or create a `DriverPayout`. The required 130000/145000/8% scenario cannot
   currently prove a 11600 commission and 133400 payout in the ledger.

### HIGH

1. **Contracts are not consumed by mobile clients.** Passenger duplicates
   `TokenPair`, `TripStatus`, `Trip` and `DriverBid`; Android duplicates all
   transport DTOs. Static type checks cannot catch API drift. In particular,
   public `RequestCodeResponseSchema`, `CurrentUserResponseSchema`,
   `TripSummarySchema` and `DriverBidSchema` do not currently describe the
   corresponding API responses used by the clients.

2. **No Docker runtime is available in the audit environment.** `docker` and
   its standard installation paths were absent. Consequently `pnpm infra:up`,
   clean migration deployment/replay, PostGIS verification, Redis health and
   persistence verification were not executable.

3. **No production payment provider is available.** Both available providers
   are deliberately blocked in production. This is safe, but means the system
   cannot be deployed to production until an approved provider is wired in.

### MEDIUM

1. No CI workflow was found to enforce the passing commands.
2. Admin mutation endpoints and room isolation have only limited unit coverage;
   browser/HTTP authorization paths are not independently exercised.
3. Android build completes with Kotlin/Android deprecation warnings.
4. The Android HTTP interceptor calls token storage through `runBlocking` on
   request execution; it should be assessed under real network load.

### LOW

1. `packages/config` and `packages/shared-types` are skeletal and have no
   tests.
2. `apps/admin-web/src/index.ts` remains an unused legacy stub beside the
   Next.js `app` directory.
3. Placeholder documentation directories are incomplete.

## Confirmed fixes made during this audit

- `packages/contracts` tests now build the package first. This fixed a clean
  checkout failure where `dist/index.js` did not exist.
- Android network models are now `@Serializable`, the serialization compiler
  plugin is enabled, and location uploads now use API fields `recordedAt` and
  `confidence` rather than `recordedAtEpochMillis` and `quality`.
- Boarding-code secret, TTL and attempt variables are validated. Test setup now
  supplies the secret.
- `TestPaymentProvider` now fails startup in production, matching the safety
  rule already used by `DevelopmentPaymentProvider`.

## Database and security assessment

- Schema review confirms money fields are PostgreSQL/Prisma `Int` and
  commission rates are `Int` basis points.
- Foreign keys, unique keys and indexes are defined in the schema/migrations;
  static review cannot prove that migrations apply on a clean database.
- Trip transitions and bid selection use version/state predicates. Tests cover
  state-machine and concurrent-bid logic, but database-backed optimistic-lock
  behavior was not run in this audit environment.
- Refresh token hashes, OTP hashes, access-token role checks, rate limits,
  session revocation and secure mobile token stores are present in code.
- Administrative mutations use `ADMIN` guards and create `AdminAuditLog` within
  their transaction.
- WebSocket code has authentication and room-authorization tests, but its
  outbox/retry behavior was not validated with Redis/PostgreSQL.

## Commands actually executed

| Check | Result |
| --- | --- |
| Clean checkout `pnpm install --frozen-lockfile` | Passed |
| Prisma client generation | Passed |
| API build | Passed |
| Admin Next.js production build | Passed |
| Passenger TypeScript check and web export | Passed |
| Root lint | Passed |
| Root typecheck | Passed |
| Root tests after fixes | Passed (API: 15 suites/55 tests; one integration suite skipped) |
| API e2e command | Passed (5 suites/8 tests; one integration suite skipped) |
| Android `assembleDevDebug`, unit tests, detekt, ktlint | Passed |
| Docker Compose startup / PostgreSQL / Redis health | Not run: Docker CLI unavailable |
| Migration deploy/replay, seed, PostGIS SQL validation | Not run: Docker CLI unavailable |
| Full DB/WebSocket/ledger scenario | Not run: no disposable infrastructure and no real test exists |

## Staging decision

**Not ready for staging.** Build and static quality gates are green after the
listed fixes, but CRITICAL ledger/lifecycle and full DB/WebSocket scenario gaps
remain. Docker-backed migration and infrastructure verification must be run in
an environment with Docker Desktop or an equivalent container runtime before a
staging decision can be changed.
