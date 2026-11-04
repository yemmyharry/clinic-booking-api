import pg from 'pg';
import { newDb } from 'pg-mem';

const { Pool } = pg;

export type DbPool = pg.Pool;

let poolInstance: DbPool | null = null;

export function getPool(connectionString?: string, forceMemory = false): DbPool {
  if (poolInstance && !connectionString && !forceMemory) {
    return poolInstance;
  }

  const conn = connectionString || process.env.DATABASE_URL;

  if (conn && !forceMemory) {
    const isLocal = conn.includes('localhost') || conn.includes('127.0.0.1');
    const pool = new Pool({
      connectionString: conn,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 20,
    });
    if (!connectionString) {
      poolInstance = pool;
    }
    return pool;
  }

  // Use in-memory Postgres emulator (pg-mem) for tests or zero-config dev
  const memDb = newDb();
  const pgAdapter = memDb.adapters.createPg();
  const memPool = new pgAdapter.Pool() as unknown as DbPool;

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
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_email_ts ON rate_limits(email, timestamp);
  `);
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
