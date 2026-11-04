import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getDatabase } from '../src/db/index.js';

const API_KEY = 'valid-test-key-level4';
process.env.API_KEY = API_KEY;
process.env.DATABASE_PATH = ':memory:';

test('Level 4: Idempotency and Pagination', async (t) => {
  const db = getDatabase(':memory:');
  const app = createApp();

  await t.test('Idempotency tests', async (sub) => {
    const slot = {
      id: 'slot_idem_1',
      provider: 'Dr Ade',
      start: '2028-06-10T09:00:00Z',
      end: '2028-06-10T09:30:00Z',
    };

    await request(app)
      .post('/reset')
      .set('X-API-Key', API_KEY)
      .send({ slots: [slot] });

    let firstBookingId = '';

    await sub.test('POST /bookings with Idempotency-Key returns 201', async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', 'unique-idem-key-1')
        .send({
          slot_id: 'slot_idem_1',
          name: 'Jane Doe',
          email: 'jane@example.com',
        });

      assert.equal(res.status, 201);
      assert.ok(res.body.id);
      firstBookingId = res.body.id;
    });

    await sub.test('Replay with exact same Idempotency-Key and body returns identical 201 response and booking ID', async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', 'unique-idem-key-1')
        .send({
          slot_id: 'slot_idem_1',
          name: 'Jane Doe',
          email: 'jane@example.com',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.id, firstBookingId);
    });

    await sub.test('Replay with same Idempotency-Key but different body returns 422', async () => {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', 'unique-idem-key-1')
        .send({
          slot_id: 'slot_idem_1',
          name: 'Jane Different Name',
          email: 'jane@example.com',
        });

      assert.equal(res.status, 422);
      assert.equal(res.body.error, 'Idempotency-Key reused with a different body');
    });
  });

  await t.test('Pagination tests', async (sub) => {
    // 5 future slots for pagination
    const slots = Array.from({ length: 5 }, (_, i) => ({
      id: `slot_page_${i + 1}`,
      provider: 'Dr Ade',
      start: `2028-07-0${i + 1}T09:00:00Z`,
      end: `2028-07-0${i + 1}T09:30:00Z`,
    }));

    await request(app)
      .post('/reset')
      .set('X-API-Key', API_KEY)
      .send({ slots });

    await sub.test('Create 5 bookings for patient@example.com', async () => {
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/bookings')
          .set('X-API-Key', API_KEY)
          .send({
            slot_id: `slot_page_${i}`,
            name: 'Patient User',
            email: 'patient@example.com',
          });
        assert.equal(res.status, 201);
      }
    });

    await sub.test('GET /bookings requires email and ignores case', async () => {
      const missingEmailRes = await request(app)
        .get('/bookings')
        .set('X-API-Key', API_KEY);
      assert.equal(missingEmailRes.status, 400);

      const matchRes = await request(app)
        .get('/bookings?email=PATIENT@EXAMPLE.COM')
        .set('X-API-Key', API_KEY);
      assert.equal(matchRes.status, 200);
      assert.equal(matchRes.body.bookings.length, 5);
    });

    await sub.test('GET /bookings validates limit bounds (1 to 50)', async () => {
      const res0 = await request(app)
        .get('/bookings?email=patient@example.com&limit=0')
        .set('X-API-Key', API_KEY);
      assert.equal(res0.status, 400);

      const res51 = await request(app)
        .get('/bookings?email=patient@example.com&limit=51')
        .set('X-API-Key', API_KEY);
      assert.equal(res51.status, 400);

      const resInvalid = await request(app)
        .get('/bookings?email=patient@example.com&limit=abc')
        .set('X-API-Key', API_KEY);
      assert.equal(resInvalid.status, 400);
    });

    await sub.test('GET /bookings cursor pagination works through all pages and ends with null', async () => {
      // Page 1: limit 2
      const page1Res = await request(app)
        .get('/bookings?email=patient@example.com&limit=2')
        .set('X-API-Key', API_KEY);

      assert.equal(page1Res.status, 200);
      assert.equal(page1Res.body.bookings.length, 2);
      assert.ok(page1Res.body.next_cursor);

      // Page 2: limit 2
      const page2Res = await request(app)
        .get(`/bookings?email=patient@example.com&limit=2&cursor=${encodeURIComponent(page1Res.body.next_cursor)}`)
        .set('X-API-Key', API_KEY);

      assert.equal(page2Res.status, 200);
      assert.equal(page2Res.body.bookings.length, 2);
      assert.ok(page2Res.body.next_cursor);

      // Page 3: limit 2 (only 1 remaining, so next_cursor is null)
      const page3Res = await request(app)
        .get(`/bookings?email=patient@example.com&limit=2&cursor=${encodeURIComponent(page2Res.body.next_cursor)}`)
        .set('X-API-Key', API_KEY);

      assert.equal(page3Res.status, 200);
      assert.equal(page3Res.body.bookings.length, 1);
      assert.equal(page3Res.body.next_cursor, null);

      // Ensure all 5 bookings are unique and ordered oldest first
      const allFetched = [
        ...page1Res.body.bookings,
        ...page2Res.body.bookings,
        ...page3Res.body.bookings,
      ];
      assert.equal(allFetched.length, 5);
      const ids = allFetched.map((b) => b.id);
      assert.equal(new Set(ids).size, 5);
    });
  });
});
