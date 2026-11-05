import pg from 'pg';
import { createRequire } from 'node:module';
import type { IMemoryDb } from 'pg-mem';

const { Pool } = pg;

export type DbPool = pg.Pool;

let poolInstance: DbPool | null = null;
const memoryDatabases = new WeakMap<DbPool, IMemoryDb>();
const memoryQueues = new WeakMap<DbPool, Promise<void>>();

export function getPool(connectionString?: string, forceMemory = false): DbPool {
  if (poolInstance && !connectionString && !forceMemory) {
    return poolInstance;
  }

  const conn = connectionString || process.env.DATABASE_URL;

  if (conn && !forceMemory) {
    const hostname = new URL(conn).hostname;
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    const pool = new Pool({
      connectionString: conn,
      // pg also respects sslmode in the connection string.
      ssl: isLocal || process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: process.env.DATABASE_SSL !== 'require' },
      max: 20,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      allowExitOnIdle: true,
    });
    if (!connectionString) {
      poolInstance = pool;
    }
    return pool;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production; memory storage is development-only');
  }

  // Load the emulator only in development. Production installs omit pg-mem.
  const { newDb } = createRequire(import.meta.url)('pg-mem') as typeof import('pg-mem');
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const memPool = new pgAdapter.Pool() as unknown as DbPool;
  memoryDatabases.set(memPool, memDb);

  if (!connectionString) {
    poolInstance = memPool;
  }

  return memPool;
}

export async function initSchema(pool: DbPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      start TEXT NOT NULL,
      slot_end TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL REFERENCES slots(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled')),
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_slot ON bookings(slot_id) WHERE status = 'confirmed';

    CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email, created_at, id);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      response_headers TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_email_ts ON rate_limits(email, timestamp);

    ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response_headers TEXT NOT NULL DEFAULT '{}';
  `);
}

/**
 * Serialize short mutations across every API process using the same database.
 * This clinic favors a simple transaction lock over separate races between the
 * rate-limit counter, idempotency record, reset, and booking insert.
 */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const memoryDb = memoryDatabases.get(pool);
  let releaseQueue: (() => void) | undefined;

  if (memoryDb) {
    const previous = memoryQueues.get(pool) ?? Promise.resolve();
    const current = new Promise<void>(resolve => { releaseQueue = resolve; });
    memoryQueues.set(pool, current);
    await previous;
  }

  let client: pg.PoolClient | undefined;
  const backup = memoryDb?.backup();
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (!memoryDb) {
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [174325, 1]);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    // pg-mem does not implement transaction rollback.
    backup?.restore();
    throw err;
  } finally {
    client?.release();
    releaseQueue?.();
  }
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
