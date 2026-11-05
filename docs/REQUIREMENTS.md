# Assessment verification

Contract: https://koyaacademy.com/assessment-api

The page uses the protected API endpoints directly and sends `X-API-Key` on each request. No public proxy bypasses authentication. Browser tests run the production build with a separate PostgreSQL database and a non-example key.

| Level | Backend behavior | Frontend behavior | Verification |
| --- | --- | --- | --- |
| 1 | List slots; create and retrieve bookings | Doctor filtering, real booking form, confirmation with appointment details, lookup by booking reference | Level 1 suite; fresh browser booking and lookup |
| 2 | Reject wrong/missing keys and invalid fields; normalize name/email | Validate API key before saving; show connection errors; validate patient form; display server validation failures inline | Level 2 and regression suites; wrong-key and normalized booking browser checks |
| 3 | Partial unique index and database transaction lock; cancellation frees the slot | Two browser pages racing get one confirmation and one conflict message; cancellation updates stored status and availability | Level 3, PostgreSQL multi-process suite, browser race and cancellation |
| 4 | Persist response with booking; replay retries; reject changed payloads; cursor pagination | Retain request key after a lost successful response; reference/email lookup; page size and Load More without duplicate bookings | Level 4 and regression suites; dropped-response and pagination browser checks |
| 5 | Five fresh attempts per normalized email per minute, including failures; integer Retry-After | Show inline rate-limit explanation and countdown; permit other emails to book | Level 5 and regression suites; real 429/countdown and other-email browser checks |

## First deployment

A schema does not include appointment inventory. The former page could show an empty schedule with no booking button and no way to initialize it. The first-run button now calls `POST /setup/demo` using the configured key. It creates 12 future slots only while the database has no slots. Simultaneous setup calls cannot duplicate inventory. It never clears bookings, retry records, or rate limits.

`POST /reset` retains the evaluator's original behavior, including an empty slot list and past slots. There is no automatic seeding on process startup or slot reads. Existing evaluator data is never replenished or replaced in the background.

Local tests verify implementation. The live deployment must contain the updated commit; verify `/health`, initialize an empty schedule from the page, book a slot, reload, look up the reference, and cancel before submitting. Keep the deployed version and database unchanged after submission.
