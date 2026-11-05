# Clinic Booking API

A clinic appointment API and web page built with TypeScript, Express, and PostgreSQL for the [Koya assessment](https://koyaacademy.com/assessment-api).

[Deploy this repository to Render](https://render.com/deploy?repo=https://github.com/yemmyharry/clinic-booking-api) to create the web service and database together.

The web page lists appointments, filters by doctor, creates bookings, shows confirmation references, cancels bookings, and pages through bookings by email. API routes implement levels 1–5 of the assessment contract.

## Run locally

Requires Node.js 22+ and npm. PostgreSQL is required for persistent storage and for production.

```sh
npm ci
cp .env.example .env
# Edit .env with your PostgreSQL connection string and API key.
npm run build
npm start
```

Open <http://localhost:3000>. Enter the same API key in the page's **API Key** settings. The key is saved in this browser's local storage. A fresh database has no appointments; seed future demo appointments explicitly:

```sh
npm run seed:demo -- --reset
```

**Seeding replaces all slots and deletes every booking.** It never runs automatically. Do not seed or reset a submitted deployment except when the assessment evaluator calls `/reset`.

For temporary development only, leave `DATABASE_URL` empty to use an in-memory emulator. It loses all state when the process stops. Production refuses to start without `DATABASE_URL` and `API_KEY`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port, default `3000` |
| `API_KEY` | Required `X-API-Key` value; required in production |
| `DATABASE_URL` | PostgreSQL connection string; required in production |
| `DATABASE_SSL` | Use `require` for Render private TLS with a self-signed certificate; `false` disables TLS for a trusted private network |
| `API_BASE_URL` | Optional base URL for the demo seed script; default `http://localhost:3000` |
| `TEST_DATABASE_URL` | PostgreSQL administrator connection used to create a disposable test database |

Keep `.env` and database passwords out of Git. Production requests use a chosen private key; the example development key is not a production secret. Static files and the database-aware `/health` endpoint are public. Every assessment API endpoint requires authentication, including malformed requests. CORS preflight requests are handled separately so browser clients can send the required headers.

## API contract

All API requests use `X-API-Key: <your-key>`. Bodies and responses are JSON; errors use `{ "error": "message" }`.

| Endpoint | Behavior |
| --- | --- |
| `POST /reset` | `{ "slots": [{ "id", "provider", "start", "end" }] }`; atomically replaces slots and clears bookings, retry records, and rate limits; accepts past slots |
| `GET /slots` | Every slot, chronologically sorted; optional exact `provider` filter; `available` is false while a confirmed booking exists |
| `POST /bookings` | `{ "slot_id", "name", "email" }`; returns `201` and a confirmed booking |
| `GET /bookings/:id` | Returns the booking or `404` |
| `DELETE /bookings/:id` | Returns the cancelled booking and frees its slot; `404` if unknown; `409` if already cancelled |
| `GET /bookings?email=...&limit=10&cursor=...` | Case-insensitive email lookup, oldest first; limit 1–50; use `next_cursor` for the next page, ending at `null` |

Booking validation returns `400` for missing, empty, non-string, or invalid fields and for slots that have started; nonexistent slots return `404`. Names and emails are trimmed, and emails are stored in lowercase. An already booked slot returns `409`.

With `Idempotency-Key`, identical payloads replay the same status and response, including failures. Different payloads with the same key return `422`. JSON object property order does not matter; values and additional fields do matter. A completed retry is the same logical attempt and does not consume another rate-limit allowance. The browser retains the key when retrying the same form after a network error.

A normalized email gets at most five fresh booking attempts in a rolling minute, including invalid or unsuccessful attempts. Further attempts return `429` with an integer `Retry-After` header. Other emails are unaffected.

## Concurrency and persistence

A PostgreSQL partial unique index permits only one confirmed booking per slot. Short mutation transactions also acquire a database advisory lock so idempotency records, rate-limit checks, bookings, cancellations, and resets remain consistent across independent API processes. Booking and retry response commit together. Validation failures commit their attempt records and retry responses as well.

This deliberately serializes writes for a small clinic. Read requests remain concurrent. Higher-volume deployments can replace the single transaction lock with carefully ordered resource locks; removing the lock without replacing its guarantees reintroduces races. The in-memory emulator uses a development-only queue and rollback backup; production uses PostgreSQL transactions and locks.

## Verification

```sh
npm test
npm run build
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/postgres npm run test:postgres
```

The PostgreSQL test runner creates and deletes its own database; it does not reset the database named in `TEST_DATABASE_URL`. The role must be allowed to create databases. Never point tests at a production application database.

The current full PostgreSQL run passes **62 tests**, including independent API replicas, simultaneous same-slot booking, retry races, conflicting keys, failed-response replay, parallel spam, cancellation races, equal-timestamp cursor pagination, and process-restart persistence. The normal memory run skips the PostgreSQL integration group. GitHub Actions runs both suites, the build, and a production-only dependency check against PostgreSQL 17.

## Deploy

Render's free database expires after 30 days. Upgrade before expiration if assessment review is still pending.

Use the included [Render Blueprint](render.yaml) to provision the web service and its PostgreSQL database together on Render. The API and web page share one HTTPS base URL. Instructions and the submission checklist are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The Docker image builds with `npm ci`, installs only production dependencies in its final stage, and runs as the `node` user. Production does not load the development database emulator.

```sh
docker build -t clinic-booking-api .
docker run --rm -p 3000:3000 --env-file .env -e NODE_ENV=production clinic-booking-api
```

Use a database hostname reachable from the container; `localhost` inside Docker refers to the container itself.
