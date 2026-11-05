# Five-minute walkthrough

Record after the HTTPS deployment is healthy. Keep API keys, database passwords, environment files, and hosting account screens out of the recording.

## 0:00–0:25 — Introduce the project

“This is my clinic booking API and patient booking page for the Koya assessment. The API uses TypeScript, Express, and PostgreSQL. The page and API are deployed at the same HTTPS URL.”

## 0:25–1:30 — Demonstrate the page

Show available slots and doctor filtering. Book one using a demo name and email. Show the confirmation reference, then refresh the page and look up the email to show that the booking persisted. Cancel it and show that the slot becomes available again.

## 1:30–2:20 — Explain the API and validation

Open `src/app.ts`, `src/middleware/auth.ts`, and `src/routes/bookings.ts`. Explain that assessment routes require `X-API-Key`; booking fields must be non-empty strings; invalid email and past slots return 400; nonexistent slots return 404. Show the endpoint list in the README.

## 2:20–3:30 — Explain concurrency and retries

Open `src/db/index.ts`. Point to the partial unique index that allows one confirmed booking per slot, and the transaction helper's PostgreSQL advisory lock. Explain that the booking and idempotency response commit together, including failed responses. Same key and same body replay the original result; a different body returns 422. The transaction lock also prevents simultaneous requests from bypassing the per-email limit.

## 3:30–4:15 — Pagination and spam prevention

Show the oldest-first booking query and cursor construction. Explain the timestamp-plus-ID tie breaker and final `next_cursor: null`. Show the rolling-minute rate-limit query and `429` with `Retry-After` after five attempts, including failed attempts.

## 4:15–4:50 — Show verification and hosting

Show the passing test output or GitHub Actions check. Mention that the PostgreSQL tests run two independent API processes, race requests, and restart all API processes to verify persistence. Show the deployed page URL and public repository. Explain that production requires a database and automatic deployments are disabled to preserve the submitted version.

Stop before five minutes. Copy the Loom share link into the assessment form alongside the API URL, key, web URL, and repository URL.
