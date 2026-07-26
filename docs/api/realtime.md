# Realtime API

The API exposes a Socket.IO namespace at `/realtime`. A client sends its access
token during the handshake as `auth: { token: accessToken }`, or in a
`Bearer` authorization header. An unauthenticated socket receives
`realtime.error` with `INVALID_ACCESS_TOKEN` and is disconnected.

Each authenticated client is joined to `user:{userId}`. It can request a trip
room with `room.join` and `{ tripId }`; access is checked against the trip, so a
passenger cannot subscribe to another passenger's trip. `room.leave` uses the
same authorization check.

Every published domain event is an envelope with `eventId`, `room`, `sequence`,
`occurredAt`, and `payload`. Sequences are monotonic per room. Clients retain
the latest sequence and use `events.replay` with `{ room, afterSequence }` when
they detect a gap. At most 100 delivered events are returned at once.

Critical trip and bid events are written to the PostgreSQL outbox in the same
transaction as their domain update, then published by a retrying dispatcher.
Delivery is at-least-once, so consumers deduplicate by `eventId`. Driver
location events are throttled per driver before entering the outbox.

The canonical TypeScript payload definitions are in
`@resilient-taxi/contracts` (`packages/contracts/src/index.ts`). Supported
event names are:

- `trip.searching`, `trip.updated`, `trip.cancelled`, `trip.started`,
  `trip.completed`, `driver.arrived`
- `bid.created`, `bid.withdrawn`, `bid.expired`, `bid.accepted`
- `driver.location.updated`
