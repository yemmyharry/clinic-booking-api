# Clinic Booking API

A clinic appointment API and web page built with TypeScript, Express, and PostgreSQL for the [Koya assessment](https://koyaacademy.com/assessment-api).

## Features

- Browse appointments and filter by doctor.
- Book a slot, receive confirmation, and find bookings by reference or email.
- Validate patient details and protect API requests with `X-API-Key`.
- Prevent double bookings and allow cancellation.
- Support idempotent retries, cursor pagination, and per-email rate limiting.

## Local setup

Requires Node.js 22+ and PostgreSQL.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Set these values in `.env` before starting:

| Variable | Value |
| --- | --- |
| `API_KEY` | Your chosen API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Optional; defaults to `3000` |
| `DATABASE_SSL` | `require` for Render private PostgreSQL connections |

Open `http://localhost:3000` and connect using your API key. If the schedule is empty, click **Create starter appointments** to add 12 future slots. This setup action never overwrites an existing schedule.

## API

All API requests require `X-API-Key`. Requests and responses use JSON.

| Endpoint | Purpose |
| --- | --- |
| `GET /slots` | List slots; optionally filter by `provider` |
| `POST /bookings` | Book a slot using `slot_id`, `name`, and `email` |
| `GET /bookings/:id` | Retrieve a booking |
| `DELETE /bookings/:id` | Cancel a booking and free its slot |
| `GET /bookings?email=...` | List bookings with `limit` and `cursor` pagination |
| `POST /setup/demo` | Create starter appointments when the schedule is empty |
| `POST /reset` | Replace slots and clear bookings for assessment testing |

Send `Idempotency-Key` with a booking request to make retries safe. Reusing a key with a different body returns `422`. Each email is limited to five fresh attempts per minute; excess attempts return `429` with `Retry-After`.

## Tests

```sh
npm test
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/postgres npm run test:postgres
npx playwright install chromium
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/postgres npm run test:browser
```

Integration tests create and remove a separate test database. The PostgreSQL suite covers all five assessment levels, and the browser suite verifies the complete booking flow.

## Render deployment

Deployment uses a **Render Hobby workspace** with a web service and PostgreSQL database.

- **Build:** `npm ci --include=dev && npm run build && npm prune --omit=dev`
- **Start:** `npm start`
- **Environment:** `NODE_ENV=production`, `API_KEY`, `DATABASE_URL`, and `DATABASE_SSL=require`
- **Health check:** `/health`

The API and web page share the service's HTTPS URL.
