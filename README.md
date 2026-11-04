# Clinic Booking API & Web Interface

A production-ready Clinic Appointment Booking API and web interface implementing all 5 levels of the [Koya Cohort 4 Assessment Specification](https://koyaacademy.com/assessment-api).

Built with **Node.js**, **TypeScript**, **Express**, and **PostgreSQL** (with connection pooling and atomic partial unique constraints).

---

## 🌟 Features by Level

- **Level 1 (Core Booking):**
  - `POST /reset`: Clears bookings, idempotency logs, and replaces all slots (including past slots).
  - `GET /slots`: Lists all slots ordered by earliest `start` first. Supports filtering by `provider` exact match. Calculates slot availability (`available: false` while confirmed booking exists).
  - `POST /bookings`: Books a slot, generating unique booking reference and status `confirmed`.
  - `GET /bookings/:id`: Looks up booking by ID (returns `404` if not found).

- **Level 2 (Security & Input Validation):**
  - Requires `X-API-Key` header on every API request. Missing or invalid keys return `401 {"error": "..."}`.
  - Returns `400` if `slot_id`, `name`, or `email` is missing or empty.
  - Returns `400` if email format is invalid.
  - Returns `404` if the slot does not exist.
  - Returns `400` if the slot has already started (`start <= now`).
  - Trims whitespace from `name` and `email`, and normalizes `email` to lowercase.

- **Level 3 (Concurrency & Cancellations):**
  - **Zero Double-Bookings Guarantee:** Guaranteed at the PostgreSQL engine level via atomic partial unique index (`WHERE status = 'confirmed'`). Concurrent requests arriving at the exact same millisecond cannot book the same slot; exactly one succeeds (`201`) and concurrent attempts return `409 {"error": "Slot already booked"}` (PostgreSQL error `23505`).
  - `DELETE /bookings/:id`: Cancels booking, transitions status to `cancelled`, and frees the slot.
  - Returns `409 {"error": "Already cancelled"}` if already cancelled.
  - Returns `404` if booking ID does not exist.

- **Level 4 (Idempotency & Pagination):**
  - Supports optional `Idempotency-Key` header on `POST /bookings`.
  - Same key with identical body replays the exact same response and booking ID without creating duplicate bookings.
  - Same key with different payload returns `422 {"error": "Idempotency-Key reused with a different body"}`.
  - `GET /bookings`: Retrieves a patient's bookings ordered oldest first (`ORDER BY created_at ASC, id ASC`). Case-insensitive email query.
  - Cursor pagination with `limit` (1–50, defaults to 10; invalid limits return `400`) and opaque `cursor` / `next_cursor` tokens (`null` on final page).

- **Level 5 (Rate Limiting & Spam Prevention):**
  - At most **5 attempts per email per minute**, failed attempts included.
  - The 6th attempt returns `429 {"error": "Too many attempts for this email"}` with a `Retry-After: <seconds>` header in whole seconds.
  - Other emails are unaffected.

- **Interactive Web Page:**
  - Modern web application served directly from `/`.
  - Live doctor filter, availability badges, booking modal, confirmation card with copyable booking ID, one-click cancellation, and "My Bookings" lookup with pagination.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ (tested up to Node 26)
- npm
- PostgreSQL database (Neon, Supabase, Render, or local). *Note: if `DATABASE_URL` is omitted, the app automatically falls back to an in-memory PostgreSQL emulator for zero-setup local dev and testing.*

### 2. Installation
```bash
git clone <repo-url>
cd clinic-booking-api
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration:
```env
PORT=3000
API_KEY=koya-secret-key-123
DATABASE_URL=postgresql://user:password@localhost:5432/clinic_booking
```
*(Leave `DATABASE_URL` blank if you want to run with the zero-config in-memory PostgreSQL engine during development).*

### 4. Run Development Server
```bash
npm run dev
```
Visit `http://localhost:3000` to open the web interface.

### 5. Build & Production Start
```bash
npm run build
npm start
```

---

## 🧪 Testing

The repository includes comprehensive automated tests covering all 5 levels and edge cases:

```bash
npm test
```

### Test Coverage Highlights:
- `tests/level1.test.ts`: Slot replacement, sorting, filtering by provider, booking creation, retrieval, and 404s.
- `tests/level2.test.ts`: `X-API-Key` 401 enforcement, missing fields, invalid email, past slots, 404 slots, and trimming/lowercasing.
- `tests/level3.test.ts`: Concurrent parallel booking race condition tests, 409 conflict checks, cancellation, and slot freeing.
- `tests/level4.test.ts`: Idempotent retries, 422 mismatch validation, limit boundary validation, and cursor pagination through pages.
- `tests/level5.test.ts`: 5-attempt sliding window rate limiting (including failed attempts), 429 response with `Retry-After` header, and email isolation.

---

## 📡 API Reference

All requests must include the header:
```http
X-API-Key: <your-api-key>
```

### 1. Reset Slots & State
```http
POST /reset
Content-Type: application/json

{
  "slots": [
    {
      "id": "s1",
      "provider": "Dr Ade",
      "start": "2026-12-10T09:00:00Z",
      "end": "2026-12-10T09:30:00Z"
    }
  ]
}
```

### 2. List Slots
```http
GET /slots
GET /slots?provider=Dr%20Ade
```

### 3. Create Booking
```http
POST /bookings
Content-Type: application/json
Idempotency-Key: <optional-uuid>

{
  "slot_id": "s1",
  "name": "Ada Obi",
  "email": "ada@example.com"
}
```

### 4. Get Booking by ID
```http
GET /bookings/{id}
```

### 5. Cancel Booking
```http
DELETE /bookings/{id}
```

### 6. List Person's Bookings (Paginated)
```http
GET /bookings?email=ada@example.com&limit=10
GET /bookings?email=ada@example.com&limit=10&cursor=<next_cursor>
```

---

## 🚢 Deployment

### Free PostgreSQL Options:
- [Neon](https://neon.tech): Free serverless Postgres with instant setup. Copy your connection string into `DATABASE_URL`.
- [Supabase](https://supabase.com): Free hosted Postgres.
- [Render Postgres](https://render.com): Free managed Postgres instance.

### Deploying to Render
1. Push this repository to GitHub.
2. Sign in to [Render](https://render.com).
3. If using [render.yaml](render.yaml), deploy via **Blueprints** to automatically provision both the Web Service and PostgreSQL database.
4. Or manually create a **Web Service**:
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `API_KEY`: `<your-chosen-api-key>`
     - `DATABASE_URL`: `<your-postgres-connection-string>`
5. Click **Deploy**. Your API and Web UI will be live at an `https://<app-name>.onrender.com` URL.
