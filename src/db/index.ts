import Database from 'better-sqlite3';
import path from 'path';

let dbInstance: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (dbInstance && !dbPath) {
    return dbInstance;
  }

  const resolvedPath = dbPath || process.env.DATABASE_PATH || path.resolve(process.cwd(), 'clinic.db');
  const db = new Database(resolvedPath);

  // Enable WAL mode for better concurrency and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);

  if (!dbPath) {
    dbInstance = db;
  }

  return db;
}

export function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL REFERENCES slots(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled')),
      created_at TEXT NOT NULL
    );

    -- Ensure a slot can have at most ONE confirmed booking at any time
    CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_slot ON bookings(slot_id) WHERE status = 'confirmed';

    -- Index for email lookup and pagination
    CREATE INDEX IF NOT EXISTS idx_bookings_email_created ON bookings(email, created_at, id);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_email_ts ON rate_limits(email, timestamp);
  `);
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
