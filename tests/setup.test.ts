import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, initSchema, closePool } from '../src/db/index.js';

process.env.API_KEY = 'setup-test-private-key';
const app = createApp();
const api = (method: 'get' | 'post', path: string) => request(app)[method](path).set('X-API-Key', process.env.API_KEY!);

test('First-run schedule setup', async t => {
  await initSchema(getPool());
  t.after(closePool);
  await api('post', '/reset').send({ slots: [] });
  await t.test('requires the configured API key', async () => {
    assert.equal((await request(app).post('/setup/demo')).status, 401);
  });
  await t.test('creates real future bookable slots on an empty database', async () => {
    const response = await api('post', '/setup/demo');
    assert.equal(response.status, 201);
    assert.equal(response.body.slots.length, 12);
    for (const slot of response.body.slots) {
      assert.ok(Date.parse(slot.start) > Date.now());
      assert.ok(Date.parse(slot.end) > Date.parse(slot.start));
    }
    const listed = await api('get', '/slots');
    assert.equal(listed.body.slots.length, 12);
    const booking = await api('post', '/bookings').send({ slot_id: listed.body.slots[0].id, name: 'Real Patient', email: 'setup@example.com' });
    assert.equal(booking.status, 201);
    assert.equal((await api('get', '/bookings/' + booking.body.id)).body.id, booking.body.id);
  });
  await t.test('never overwrites an existing schedule or bookings', async () => {
    const before = (await api('get', '/slots')).body;
    assert.equal((await api('post', '/setup/demo')).status, 409);
    assert.deepEqual((await api('get', '/slots')).body, before);
    assert.equal((await api('get', '/bookings?email=setup@example.com')).body.bookings.length, 1);
  });
  await t.test('simultaneous setup calls cannot duplicate the schedule', async () => {
    await api('post', '/reset').send({ slots: [] });
    const responses = await Promise.all(Array.from({ length: 8 }, () => api('post', '/setup/demo')));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 409).length, 7);
    assert.equal((await api('get', '/slots')).body.slots.length, 12);
  });
  await t.test('reset remains authoritative and empty slots are never automatically seeded', async () => {
    await api('post', '/reset').send({ slots: [] });
    assert.deepEqual((await api('get', '/slots')).body, { slots: [] });
    assert.deepEqual((await api('get', '/slots')).body, { slots: [] });
  });
});
