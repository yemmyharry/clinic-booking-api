import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { getPool, initSchema, closePool, withTransaction } from '../src/db/index.js';

const API_KEY = 'postgres-integration-key';
const children = new Set<ChildProcess>();
async function startReplica() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', API_KEY, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('API replica did not start: ' + output)), 15000);
    child.stdout!.on('data', chunk => {
      output += chunk;
      const match = output.match(/listening on (http:\/\/localhost:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.stderr!.on('data', chunk => { output += chunk; });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('API replica exited ' + code + ': ' + output)); });
  });
  return { child, url };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  children.delete(child);
}
const slot = (id: string) => ({ id, provider: 'Dr Integration', start: '2035-12-01T09:00:00Z', end: '2035-12-01T09:30:00Z' });
async function api(url: string, route: string, method = 'GET', body?: unknown, key?: string) {
  const response = await fetch(url + route, {
    method,
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() as any };
}

test('Real PostgreSQL: independent API processes and restart persistence', { skip: process.env.RUN_POSTGRES_TESTS !== '1' }, async t => {
  process.env.API_KEY = API_KEY;
  await initSchema(getPool());
  t.after(async () => {
    await Promise.all([...children].map(stop));
    await closePool();
  });
  const replicas = await Promise.all([startReplica(), startReplica()]);
  const reset = async (slots: ReturnType<typeof slot>[]) => assert.equal((await api(replicas[0].url, '/reset', 'POST', { slots })).status, 200);

  await t.test('the transaction lock works across independent API processes', async () => {
    await reset([slot('race')]);
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => api(replicas[i % 2].url, '/bookings', 'POST', { slot_id: 'race', name: 'Patient', email: `patient${i}@example.com` })));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal(results.filter(r => r.status === 409).length, 23);
  });

  await t.test('rate limiting cannot be bypassed by using another process', async () => {
    await reset(Array.from({ length: 12 }, (_, i) => slot(`spam${i}`)));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => api(replicas[i % 2].url, '/bookings', 'POST', { slot_id: `spam${i}`, name: 'Patient', email: 'spam@example.com' })));
    assert.equal(results.filter(r => r.status === 201).length, 5);
    assert.equal(results.filter(r => r.status === 429).length, 7);
  });

  let booking: any;
  await t.test('concurrent retries across processes return one identical response', async () => {
    await reset([slot('retry')]);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => api(replicas[i % 2].url, '/bookings', 'POST', { slot_id: 'retry', name: 'Patient', email: 'retry@example.com' }, 'cross-process-key')));
    booking = results[0].body;
    for (const result of results) {
      assert.equal(result.status, 201);
      assert.deepEqual(result.body, booking);
    }
  });

  await t.test('bookings and retry responses survive every API process restarting', async () => {
    await Promise.all(replicas.map(replica => stop(replica.child)));
    const restarted = await startReplica();
    assert.deepEqual((await api(restarted.url, '/bookings/' + booking.id)).body, booking);
    const replay = await api(restarted.url, '/bookings', 'POST', { slot_id: 'retry', name: 'Patient', email: 'retry@example.com' }, 'cross-process-key');
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, booking);
  });

  await t.test('a transaction failure rolls back all writes', async () => {
    await assert.rejects(withTransaction(async client => {
      await client.query('INSERT INTO slots (id, provider, start, slot_end) VALUES ($1,$2,$3,$4)', ['rollback', 'Doctor', '2035-01-01T00:00:00Z', '2035-01-01T00:30:00Z']);
      throw new Error('Intentional rollback');
    }), /Intentional rollback/);
    assert.equal((await getPool().query('SELECT * FROM slots WHERE id = $1', ['rollback'])).rows.length, 0);
  });
});
