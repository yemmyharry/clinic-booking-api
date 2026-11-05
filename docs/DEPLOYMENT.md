# Deployment and submission

The assessment allows a free host. This project uses one Render web service for both the API and web page, with a separate persistent PostgreSQL database.

## Provision

[Open the Render Blueprint setup](https://render.com/deploy?repo=https://github.com/yemmyharry/clinic-booking-api).

1. In Render, create a Blueprint from `yemmyharry/clinic-booking-api`. The repository includes `render.yaml`.
2. The Blueprint provisions a free Node web service and a free PostgreSQL 17 database in Frankfurt. It supplies the private database connection string automatically.
3. Render generates `API_KEY`; retrieve it from the service's environment settings and save it securely for the submission form. Private database connections require TLS with Render's self-signed certificate (`DATABASE_SSL=require`).
4. The Blueprint builds with development dependencies, compiles TypeScript, then removes development dependencies before starting. `/health` checks database connectivity. Automatic deploys are off.
5. Wait until the service reports healthy. Copy its HTTPS URL; it is both the API base URL and web page URL.
6. Open the page, enter the generated API key in its settings, and explicitly seed future demo slots once before recording:

   ```sh
   API_BASE_URL=https://YOUR-SERVICE.onrender.com API_KEY=YOUR_KEY npm run seed:demo -- --reset
   ```

   Supply secrets through your terminal environment or an ignored `.env` file. Never commit them or include them in recordings.

Render's free PostgreSQL databases expire after 30 days. Upgrade the database before expiration if the assessment review is still pending; do not allow a submitted database to expire. Free Render web services can sleep when idle and wake on the next request. Do not enable paid plans without deciding to pay for them.

## Verify the deployed service

- `/health` returns `200` and reports healthy.
- An API request without the key returns `401`.
- The page lists future slots and filters doctors.
- Booking a slot shows a confirmation reference and makes it unavailable.
- Looking up a booking returns the same stored booking on a later request.
- Cancelling it frees the slot.
- Check duplicate booking, idempotency, pagination, and spam controls on test slots before submission.
- Restart the service and verify a saved booking and retry response still exist.

Never run the local test suites against a submitted deployment. `/reset` is part of the required evaluator contract, and it clears all bookings.

## Submission fields

| Field | Value |
| --- | --- |
| API base URL | The deployed HTTPS Render URL, without a trailing API prefix |
| API key | The production `API_KEY`, provided privately in the assessment form |
| Web page URL | The same HTTPS URL, with `/` |
| GitHub repository | `https://github.com/yemmyharry/clinic-booking-api` |
| Loom | A recording of five minutes or less, showing the page and a code walkthrough; see `LOOM_SCRIPT.md` |

Before submitting, confirm the repository is public or give the evaluator `quadri40` access. Tag the exact submitted commit, retain the deployed version, keep the service and database active, and make no further changes until contacted. Do not submit the assessment form automatically.

Official references: [Render CLI](https://render.com/docs/cli), [Render Blueprint fields](https://render.com/docs/blueprint-spec), [Render free-service limits](https://render.com/docs/free).
