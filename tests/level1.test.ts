import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db/index.js';

const API_KEY = 'test-key-level1';
process.env.API_KEY = API_KEY;
process.env.DATABASE_PATH = ':memory:';

test('Level 1: Basic booking workflow', async (t) => {
  const db = getDatabase(':memory:');
  const app = createApp();

  await t.test('POST /reset replaces all slots and clears bookings', async () => {
    const slotsPayload = [
      {
        id: 's2',
        provider: 'Dr Ade',
        start: '2026-12-10T10:00:00Z',
        end: '2026-12-10T10:30:00Z',
      },
      {
        id: 's1',
        provider: 'Dr Smith',
        start: '2026-12-10T09:00:00Z',
        end: '2026-12-10T09:30:00Z',
      },
    ];

    const res = await request(app)
      .post('/reset')
      .set('X-API-Key', API_KEY)
      .send({ slots: slotsPayload });

    assert.equal(res.status, 200);
  });

  await t.test('GET /slots lists slots sorted by earliest start first', async () => {
    const res = await request(app)
      .get('/slots')
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.slots));
    assert.equal(res.body.slots.length, 2);

    // Earliest start first (s1 at 09:00 before s2 at 10:00)
    assert.equal(res.body.slots[0].id, 's1');
    assert.equal(res.body.slots[0].available, true);
    assert.equal(res.body.slots[1].id, 's2');
    assert.equal(res.body.slots[1].available, true);
  });

  await t.test('GET /slots?provider filters by exact provider match', async () => {
    const res = await request(app)
      .get('/slots?provider=Dr Ade')
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 200);
    assert.equal(res.body.slots.length, 1);
    assert.equal(res.body.slots[0].id, 's2');
    assert.equal(res.body.slots[0].provider, 'Dr Ade');
  });

  let createdBookingId = '';

  await t.test('POST /bookings creates a booking with status confirmed', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's1',
        name: 'Ada Obi',
        email: 'ada@example.com',
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.equal(res.body.slot_id, 's1');
    assert.equal(res.body.name, 'Ada Obi');
    assert.equal(res.body.email, 'ada@example.com');
    assert.equal(res.body.status, 'confirmed');
    assert.ok(res.body.created_at);

    createdBookingId = res.body.id;
  });

  await t.test('GET /slots reflects slot availability is now false', async () => {
    const res = await request(app)
      .get('/slots')
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 200);
    const slot1 = res.body.slots.find((s: any) => s.id === 's1');
    assert.equal(slot1.available, false);

    const slot2 = res.body.slots.find((s: any) => s.id === 's2');
    assert.equal(slot2.available, true);
  });

  await t.test('GET /bookings/:id returns the booking', async () => {
    const res = await request(app)
      .get(`/bookings/${createdBookingId}`)
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdBookingId);
    assert.equal(res.body.slot_id, 's1');
    assert.equal(res.body.status, 'confirmed');
  });

  await t.test('GET /bookings/:id returns 404 for unknown booking', async () => {
    const res = await request(app)
      .get('/bookings/unknown_id_123')
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });
});
