# Clinic Booking API & Web Interface

A production-ready Clinic Appointment Booking API and web interface implementing all 5 levels of the [Koya Cohort 4 Assessment Specification](https://koyaacademy.com/assessment-api).

Built with **Node.js**, **TypeScript**, **Express**, and **SQLite** (with WAL mode and atomic constraint guarantees).

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
  - **Zero Double-Bookings Guarantee:** Guaranteed at the database engine level via SQLite atomic partial unique index (`WHERE status = 'confirmed'`). Concurrent requests arriving at the exact same millisecond cannot book the same slot; exactly one succeeds (`201`) and concurrent attempts return `409 {"error": "Slot already booked"}`.
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
DATABASE_PATH=./clinic.db
```

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

### Deploying to Render (Recommended - Free)
1. Push this repository to GitHub.
2. Sign in to [Render](https://render.com).
3. Click **New +** -> **Web Service** -> Connect your GitHub repository.
4. Set:
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
5. Under **Environment Variables**, set:
   - `API_KEY`: `<your-chosen-api-key>`
   - `DATABASE_PATH`: `./clinic.db`
6. Click **Create Web Service**. Your API and Web UI will be live at an `https://<app-name>.onrender.com` URL.

### Deploying via Docker
```bash
docker build -t clinic-booking-api .
docker run -p 3000:3000 -e API_KEY="your-secret-key" clinic-booking-api
```
