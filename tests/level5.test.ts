import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getDatabase } from '../src/db/index.js';

const API_KEY = 'valid-test-key-level5';
process.env.API_KEY = API_KEY;
process.env.DATABASE_PATH = ':memory:';

test('Level 5: Rate Limiting spam prevention', async (t) => {
  const db = getDatabase(':memory:');
  const app = createApp();

  const slots = Array.from({ length: 10 }, (_, i) => ({
    id: `rate_slot_${i + 1}`,
    provider: 'Dr Ade',
    start: `2029-01-01T0${i}:00:00Z`,
    end: `2029-01-01T0${i}:30:00Z`,
  }));

  await request(app)
    .post('/reset')
    .set('X-API-Key', API_KEY)
    .send({ slots });

  const spamEmail = 'spammer@example.com';
  const innocentEmail = 'innocent@example.com';

  await t.test('5 attempts (even failed ones) succeed or fail normally without 429', async () => {
    // 3 valid attempts
    for (let i = 1; i <= 3; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: `rate_slot_${i}`,
          name: 'Spam User',
          email: spamEmail,
        });
      assert.equal(res.status, 201);
    }

    // 2 failed attempts (invalid slot) - failed attempts included!
    for (let i = 1; i <= 2; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'non_existent_slot_id',
          name: 'Spam User',
          email: spamEmail,
        });
      assert.equal(res.status, 404);
    }
  });

  await t.test('6th attempt for same email returns 429 with whole seconds Retry-After header', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'rate_slot_4',
        name: 'Spam User',
        email: spamEmail,
      });

    assert.equal(res.status, 429);
    assert.equal(res.body.error, 'Too many attempts for this email');

    const retryAfter = res.headers['retry-after'];
    assert.ok(retryAfter, 'Retry-After header must be present');
    const retrySec = Number(retryAfter);
    assert.ok(Number.isInteger(retrySec), 'Retry-After must be an integer');
    assert.ok(retrySec >= 1 && retrySec <= 60, 'Retry-After should be between 1 and 60 seconds');
  });

  await t.test('Other emails are completely unaffected by the rate limit', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'rate_slot_5',
        name: 'Innocent User',
        email: innocentEmail,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.email, innocentEmail);
  });
});
