import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, initSchema, closePool } from '../src/db/index.js';

process.env.API_KEY = 'regression-test-key';
const app = createApp();
const api = (method: 'get' | 'post' | 'delete', route: string) => request(app)[method](route).set('X-API-Key', process.env.API_KEY!);
const slot = (id: string, start = '2035-12-01T09:00:00Z', end = '2035-12-01T09:30:00Z') => ({ id, provider: 'Dr Audit', start, end });
const reset = async (slots = [slot('s1')]) => {
  const res = await api('post', '/reset').send({ slots });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};
const body = (slot_id = 's1', email = 'patient@example.com') => ({ slot_id, name: 'Ada Obi', email });

test('Contract regressions and concurrent requests', async t => {
  await initSchema(getPool());
  t.after(closePool);

  await t.test('orders slots by their actual instant across timezone offsets', async () => {
    await reset([
      slot('earlier', '2035-12-01T09:00:00+02:00', '2035-12-01T09:30:00+02:00'),
      slot('later', '2035-12-01T08:00:00Z', '2035-12-01T08:30:00Z'),
    ]);
    const res = await api('get', '/slots');
    assert.deepEqual(res.body.slots.map((s: any) => s.id), ['earlier', 'later']);
  });

  await t.test('rejects non-string booking fields', async () => {
    for (const field of ['slot_id', 'name', 'email']) {
      for (const value of [{ bad: true }, ['bad'], 123, false]) {
        await reset();
        const res = await api('post', '/bookings').send({ ...body(), [field]: value });
        assert.equal(res.status, 400, `${field}: ${JSON.stringify(value)}`);
      }
    }
  });

  await t.test('checks authentication before parsing JSON', async () => {
    const res = await request(app).post('/bookings').set('Content-Type', 'application/json').send('{');
    assert.equal(res.status, 401);
    const authorized = await api('post', '/bookings').set('Content-Type', 'application/json').send('{');
    assert.equal(authorized.status, 400);
    assert.equal(typeof authorized.body.error, 'string');
  });

  await t.test('an invalid reset leaves existing slots and bookings intact', async () => {
    await reset();
    const booking = await api('post', '/bookings').send(body());
    assert.equal(booking.status, 201);
    for (const slots of [
      [slot('replacement'), slot('replacement')],
      [slot('replacement'), { ...slot('bad'), start: 'not-a-date' }],
      [slot('replacement'), { ...slot('bad'), provider: {} }],
    ]) {
      assert.equal((await api('post', '/reset').send({ slots })).status, 400);
      assert.equal((await api('get', '/bookings/' + booking.body.id)).status, 200);
      assert.deepEqual((await api('get', '/slots')).body.slots.map((s: any) => s.id), ['s1']);
    }
  });

  await t.test('many different patients can never double-book one slot', async () => {
    await reset();
    const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => api('post', '/bookings').send(body('s1', `person${i}@example.com`))));
    assert.equal(replies.filter(r => r.status === 201).length, 1);
    assert.equal(replies.filter(r => r.status === 409).length, 19);
  });

  await t.test('simultaneous identical retries all replay the exact booking', async () => {
    await reset();
    const replies = await Promise.all(Array.from({ length: 12 }, () => api('post', '/bookings').set('Idempotency-Key', 'concurrent-key').send(body())));
    for (const reply of replies) {
      assert.equal(reply.status, 201);
      assert.deepEqual(reply.body, replies[0].body);
    }
    assert.equal((await api('get', '/bookings?email=patient@example.com')).body.bookings.length, 1);
  });

  await t.test('simultaneous different bodies with one key return 422 and create one booking', async () => {
    await reset([slot('a'), slot('b')]);
    const replies = await Promise.all(['a', 'b'].map(id => api('post', '/bookings').set('Idempotency-Key', 'conflicting-key').send(body(id))));
    assert.deepEqual(replies.map(r => r.status).sort(), [201, 422]);
    assert.equal((await api('get', '/bookings?email=patient@example.com')).body.bookings.length, 1);
  });

  await t.test('idempotency compares every field while ignoring object property order', async () => {
    await reset();
    const original = await api('post', '/bookings').set('Idempotency-Key', 'whole-body').send({ ...body(), metadata: { a: 1, b: 2 } });
    const reordered = await api('post', '/bookings').set('Idempotency-Key', 'whole-body').send({ metadata: { b: 2, a: 1 }, email: body().email, name: body().name, slot_id: 's1' });
    assert.equal(reordered.status, 201);
    assert.deepEqual(reordered.body, original.body);
    const changed = await api('post', '/bookings').set('Idempotency-Key', 'whole-body').send({ ...body(), metadata: { a: 2, b: 2 } });
    assert.equal(changed.status, 422);
  });

  await t.test('a failed response is replayed after the slot becomes available', async () => {
    await reset();
    const taken = await api('post', '/bookings').send(body('s1', 'first@example.com'));
    const first = await api('post', '/bookings').set('Idempotency-Key', 'failed-key').send(body());
    assert.equal(first.status, 409);
    await api('delete', '/bookings/' + taken.body.id);
    const replay = await api('post', '/bookings').set('Idempotency-Key', 'failed-key').send(body());
    assert.equal(replay.status, first.status);
    assert.deepEqual(replay.body, first.body);
    assert.equal((await api('get', '/slots')).body.slots[0].available, true);
  });

  await t.test('invalid requests are cached and keys cannot be reused with corrections', async () => {
    await reset();
    const invalid = { slot_id: 's1', email: 'patient@example.com' };
    const first = await api('post', '/bookings').set('Idempotency-Key', 'invalid-key').send(invalid);
    const replay = await api('post', '/bookings').set('Idempotency-Key', 'invalid-key').send(invalid);
    assert.equal(first.status, 400);
    assert.deepEqual(replay.body, first.body);
    assert.equal((await api('post', '/bookings').set('Idempotency-Key', 'invalid-key').send(body())).status, 422);
  });

  await t.test('parallel spam admits five attempts and rejects the rest', async () => {
    await reset(Array.from({ length: 12 }, (_, i) => slot(`spam${i}`)));
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => api('post', '/bookings').send(body(`spam${i}`, i % 2 ? 'SPAM@EXAMPLE.COM' : ' spam@example.com '))));
    assert.equal(replies.filter(r => r.status === 201).length, 5);
    assert.equal(replies.filter(r => r.status === 429).length, 7);
    for (const reply of replies.filter(r => r.status === 429)) {
      assert.match(reply.headers['retry-after'], /^\d+$/);
      assert.ok(Number(reply.headers['retry-after']) >= 1);
    }
    const available = (await api('get', '/slots')).body.slots.find((s: any) => s.available);
    assert.equal((await api('post', '/bookings').send(body(available.id, 'other@example.com'))).status, 201);
  });

  await t.test('failed attempts consume the limit and the window expires', async () => {
    await reset();
    for (let i = 0; i < 5; i++) assert.equal((await api('post', '/bookings').send(body('missing'))).status, 404);
    assert.equal((await api('post', '/bookings').send(body())).status, 429);
    await getPool().query('UPDATE rate_limits SET timestamp = $1', [Date.now() - 60001]);
    assert.equal((await api('post', '/bookings').send(body())).status, 201);
  });

  await t.test('conflicting-key failures also consume the email allowance', async () => {
    await reset();
    assert.equal((await api('post', '/bookings').set('Idempotency-Key', 'mismatch-limit').send(body())).status, 201);
    for (let i = 0; i < 4; i++) {
      assert.equal((await api('post', '/bookings').set('Idempotency-Key', 'mismatch-limit').send({ ...body(), name: 'Different' })).status, 422);
    }
    assert.equal((await api('post', '/bookings').set('Idempotency-Key', 'mismatch-limit').send({ ...body(), name: 'Different' })).status, 429);
    // A replay of the original request is still the original logical attempt.
    assert.equal((await api('post', '/bookings').set('Idempotency-Key', 'mismatch-limit').send(body())).status, 201);
  });

  await t.test('only one simultaneous cancellation succeeds', async () => {
    await reset();
    const booking = await api('post', '/bookings').send(body());
    const replies = await Promise.all(Array.from({ length: 8 }, () => api('delete', '/bookings/' + booking.body.id)));
    assert.equal(replies.filter(r => r.status === 200).length, 1);
    assert.equal(replies.filter(r => r.status === 409).length, 7);
    assert.equal((await api('get', '/slots')).body.slots[0].available, true);
  });

  await t.test('pagination handles equal timestamps, cancelled bookings, and email isolation', async () => {
    await reset([slot('a'), slot('b'), slot('c'), slot('d')]);
    const bookings = [];
    for (const id of ['a', 'b', 'c']) bookings.push((await api('post', '/bookings').send(body(id))).body);
    await api('delete', '/bookings/' + bookings[1].id);
    await api('post', '/bookings').send(body('d', 'other@example.com'));
    await getPool().query('UPDATE bookings SET created_at = $1', ['2030-01-01T00:00:00.000Z']);
    const fetched = [];
    let cursor: string | null = null;
    do {
      const page = await api('get', '/bookings').query({ email: 'PATIENT@EXAMPLE.COM', limit: 1, ...(cursor ? { cursor } : {}) });
      assert.equal(page.status, 200);
      fetched.push(...page.body.bookings);
      cursor = page.body.next_cursor;
    } while (cursor);
    assert.deepEqual(fetched.map(b => b.id), bookings.map(b => b.id).sort());
    assert.equal(fetched.filter(b => b.status === 'cancelled').length, 1);
    assert.equal((await api('get', '/bookings?email=missing@example.com')).body.next_cursor, null);
  });

  await t.test('rejects malformed and repeated pagination parameters', async () => {
    for (const query of ['limit=1.2', 'limit=-1', 'limit=1&limit=2', 'cursor=', 'cursor=bad!', 'cursor=x&cursor=y']) {
      assert.equal((await api('get', '/bookings?email=patient@example.com&' + query)).status, 400, query);
    }
  });

  await t.test('reset clears retry keys and rate-limit state, and accepts past slots', async () => {
    await reset();
    await api('post', '/bookings').set('Idempotency-Key', 'reset-key').send(body());
    await reset([slot('past', '2020-01-01T09:00:00Z', '2020-01-01T09:30:00Z')]);
    assert.equal((await getPool().query('SELECT * FROM idempotency_keys')).rows.length, 0);
    assert.equal((await getPool().query('SELECT * FROM rate_limits')).rows.length, 0);
    assert.equal((await api('post', '/bookings').send(body('past'))).status, 400);
  });
});
