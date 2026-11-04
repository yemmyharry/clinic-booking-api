import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getDatabase } from '../src/db/index.js';

const API_KEY = 'valid-test-key-level3';
process.env.API_KEY = API_KEY;
process.env.DATABASE_PATH = ':memory:';

test('Level 3: Concurrency and Cancellation', async (t) => {
  const db = getDatabase(':memory:');
  const app = createApp();

  const slot = {
    id: 's_concurrent',
    provider: 'Dr Ade',
    start: '2028-05-10T09:00:00Z',
    end: '2028-05-10T09:30:00Z',
  };

  await request(app)
    .post('/reset')
    .set('X-API-Key', API_KEY)
    .send({ slots: [slot] });

  let successfulBookingId = '';

  await t.test('Two people booking the same slot at the exact same moment: exactly one 201, one 409', async () => {
    const p1 = request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_concurrent',
        name: 'Person One',
        email: 'person1@example.com',
      });

    const p2 = request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_concurrent',
        name: 'Person Two',
        email: 'person2@example.com',
      });

    const [res1, res2] = await Promise.all([p1, p2]);
    const statuses = [res1.status, res2.status].sort();

    assert.deepEqual(statuses, [201, 409]);

    const successRes = res1.status === 201 ? res1 : res2;
    const conflictRes = res1.status === 409 ? res1 : res2;

    assert.equal(conflictRes.body.error, 'Slot already booked');
    successfulBookingId = successRes.body.id;
  });

  await t.test('Subsequent booking attempt on confirmed slot returns 409', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_concurrent',
        name: 'Person Three',
        email: 'person3@example.com',
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Slot already booked');
  });

  await t.test('DELETE /bookings/:id cancels the booking and frees the slot', async () => {
    const res = await request(app)
      .delete(`/bookings/${successfulBookingId}`)
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 200);
    assert.equal(res.body.id, successfulBookingId);
    assert.equal(res.body.status, 'cancelled');

    // Verify slot is now available again
    const slotsRes = await request(app)
      .get('/slots')
      .set('X-API-Key', API_KEY);

    const targetSlot = slotsRes.body.slots.find((s: any) => s.id === 's_concurrent');
    assert.equal(targetSlot.available, true);
  });

  await t.test('DELETE /bookings/:id on already cancelled booking returns 409', async () => {
    const res = await request(app)
      .delete(`/bookings/${successfulBookingId}`)
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Already cancelled');
  });

  await t.test('DELETE /bookings/:id on non-existent booking returns 404', async () => {
    const res = await request(app)
      .delete('/bookings/fake_id_999')
      .set('X-API-Key', API_KEY);

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });

  await t.test('Freed slot can now be booked by a new patient', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 's_concurrent',
        name: 'Person Three',
        email: 'person3@example.com',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'confirmed');
  });
});
