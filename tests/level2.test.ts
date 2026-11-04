import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, initSchema } from '../src/db/index.js';

const API_KEY = 'valid-test-key-level2';
process.env.API_KEY = API_KEY;

test('Level 2: Authentication and Validation', async (t) => {
  const pool = getPool();
  await initSchema(pool);
  const app = createApp();

  const pastSlot = {
    id: 's_past',
    provider: 'Dr Past',
    start: '2020-01-01T09:00:00Z',
    end: '2020-01-01T09:30:00Z',
  };

  const futureSlot = {
    id: 's_future',
    provider: 'Dr Future',
    start: '2027-01-01T09:00:00Z',
    end: '2027-01-01T09:30:00Z',
  };

  // Setup initial slots
  await request(app)
    .post('/reset')
    .set('X-API-Key', API_KEY)
    .send({ slots: [pastSlot, futureSlot] });

  await t.test('Missing X-API-Key returns 401', async () => {
    const res = await request(app).get('/slots');
    assert.equal(res.status, 401);
    assert.ok(res.body.error);
  });

  await t.test('Wrong X-API-Key returns 401', async () => {
    const res = await request(app)
      .get('/slots')
      .set('X-API-Key', 'wrong-key');
    assert.equal(res.status, 401);
    assert.ok(res.body.error);
  });

  await t.test('Missing required fields returns 400', async () => {
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ name: 'Ada', email: 'ada@example.com' });
    assert.equal(res1.status, 400);

    const res2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: 's_future', email: 'ada@example.com' });
    assert.equal(res2.status, 400);

    const res3 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: 's_future', name: 'Ada' });
    assert.equal(res3.status, 400);
  });

  await t.test('Empty strings after trim return 400', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: '   ', name: '   ', email: '   ' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test('Invalid email address returns 400', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_future',
        name: 'Ada Obi',
        email: 'invalid-email-no-at',
      });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test('Slot does not exist returns 404', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'non_existent_slot',
        name: 'Ada Obi',
        email: 'ada@example.com',
      });
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  await t.test('Slot that has already started returns 400', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_past',
        name: 'Ada Obi',
        email: 'ada@example.com',
      });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test('Trims name/email and lowercases email', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_future',
        name: '   Ada Lovelace   ',
        email: '   ADA.LOVE@EXAMPLE.COM   ',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Ada Lovelace');
    assert.equal(res.body.email, 'ada.love@example.com');
  });
});
