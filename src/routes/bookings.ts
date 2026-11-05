import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { getPool, withTransaction } from '../db/index.js';

const router = Router();

interface BookingRecord {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}

interface ApiResult {
  status: number;
  body: BookingRecord | { error: string };
  headers?: Record<string, string>;
}

// Ignore JSON property order, but compare the complete original payload.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

router.post('/bookings', async (req: Request, res: Response) => {
  const idempotencyKey = req.header('Idempotency-Key');
  const requestHash = crypto.createHash('sha256').update(canonicalJson(req.body ?? null)).digest('hex');

  const result = await withTransaction<ApiResult>(async client => {
    let mismatchedKey = false;
    if (idempotencyKey) {
      const cached = await client.query(
        'SELECT status_code, response_body, response_headers, request_hash FROM idempotency_keys WHERE key = $1',
        [idempotencyKey]
      );
      if (cached.rows.length) {
        const row = cached.rows[0];
        if (row.request_hash !== requestHash) {
          mismatchedKey = true;
        } else {
          return { status: row.status_code, body: JSON.parse(row.response_body), headers: JSON.parse(row.response_headers) };
        }
      }
    }

    const finish = async (response: ApiResult): Promise<ApiResult> => {
      if (idempotencyKey && !mismatchedKey) {
        await client.query(
          'INSERT INTO idempotency_keys (key, request_hash, status_code, response_body, response_headers, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [idempotencyKey, requestHash, response.status, JSON.stringify(response.body), JSON.stringify(response.headers ?? {}), Date.now()]
        );
      }
      return response;
    };

    const { slot_id, name, email } = req.body ?? {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    // The check and increment run in the same database transaction as booking.
    // Concurrent requests, including requests to different API replicas, wait.
    if (normalizedEmail) {
      const now = Date.now();
      await client.query('DELETE FROM rate_limits WHERE timestamp <= $1', [now - 60000]);
      const attempts = await client.query(
        'SELECT timestamp FROM rate_limits WHERE email = $1 AND timestamp > $2 ORDER BY timestamp ASC',
        [normalizedEmail, now - 60000]
      );
      if (attempts.rows.length >= 5) {
        const retryAfter = Math.max(1, Math.ceil((Number(attempts.rows[0].timestamp) + 60000 - now) / 1000));
        return finish({ status: 429, body: { error: 'Too many attempts for this email' }, headers: { 'Retry-After': String(retryAfter) } });
      }
      await client.query('INSERT INTO rate_limits (email, timestamp) VALUES ($1, $2)', [normalizedEmail, now]);
    }

    if (mismatchedKey) {
      return { status: 422, body: { error: 'Idempotency-Key reused with a different body' } };
    }

    if ([slot_id, name, email].some(value => typeof value !== 'string' || !value.trim())) {
      return finish({ status: 400, body: { error: 'slot_id, name, and email must be non-empty strings' } });
    }
    const slotId = (slot_id as string).trim();
    const patientName = (name as string).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return finish({ status: 400, body: { error: 'Invalid email address' } });
    }

    const slots = await client.query('SELECT start FROM slots WHERE id = $1', [slotId]);
    if (!slots.rows.length) return finish({ status: 404, body: { error: 'Slot not found' } });
    if (new Date(slots.rows[0].start).getTime() <= Date.now()) {
      return finish({ status: 400, body: { error: 'The slot has already started' } });
    }

    const booking: BookingRecord = {
      id: 'b_' + crypto.randomUUID().replace(/-/g, ''),
      slot_id: slotId,
      name: patientName,
      email: normalizedEmail,
      status: 'confirmed',
      created_at: new Date().toISOString(),
    };
    const inserted = await client.query(
      'INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id',
      [booking.id, booking.slot_id, booking.name, booking.email, booking.status, booking.created_at]
    );
    if (!inserted.rows.length) return finish({ status: 409, body: { error: 'Slot already booked' } });
    return finish({ status: 201, body: booking });
  });

  res.set(result.headers ?? {}).status(result.status).json(result.body);
});

// GET /bookings (Level 4 · List a person's bookings)
router.get('/bookings', async (req: Request, res: Response) => {
  const { email, limit, cursor } = req.query;

  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'email query parameter is required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  let pageLimit = 10;
  if (limit !== undefined) {
    const limitStr = typeof limit === 'string' ? limit : '';
    if (!/^\d+$/.test(limitStr)) {
      res.status(400).json({ error: 'Invalid limit: must be an integer between 1 and 50' });
      return;
    }
    const parsedLimit = parseInt(limitStr, 10);
    if (parsedLimit < 1 || parsedLimit > 50) {
      res.status(400).json({ error: 'Invalid limit: must be between 1 and 50' });
      return;
    }
    pageLimit = parsedLimit;
  }

  const pool = getPool();

  let query: string;
  let params: any[];

  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor)) throw new Error('Invalid cursor');
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [cursorCreatedAt, cursorId] = decoded.split('|');
      if (decoded.split('|').length !== 2 || !cursorCreatedAt || !cursorId || !Number.isFinite(Date.parse(cursorCreatedAt))) {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }

      query = `
        SELECT id, slot_id, name, email, status, created_at
        FROM bookings
        WHERE LOWER(email) = LOWER($1)
          AND (created_at > $2 OR (created_at = $2 AND id > $3))
        ORDER BY created_at ASC, id ASC
        LIMIT $4
      `;
      params = [normalizedEmail, cursorCreatedAt, cursorId, pageLimit + 1];
    } catch {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
  } else {
    query = `
      SELECT id, slot_id, name, email, status, created_at
      FROM bookings
      WHERE LOWER(email) = LOWER($1)
      ORDER BY created_at ASC, id ASC
      LIMIT $2
    `;
    params = [normalizedEmail, pageLimit + 1];
  }

  try {
    const result = await pool.query(query, params);
    const rows = result.rows as BookingRecord[];

    let next_cursor: string | null = null;
    let bookings: BookingRecord[];

    if (rows.length > pageLimit) {
      bookings = rows.slice(0, pageLimit);
      const lastItem = bookings[bookings.length - 1];
      next_cursor = Buffer.from(`${lastItem.created_at}|${lastItem.id}`).toString('base64');
    } else {
      bookings = rows;
      next_cursor = null;
    }

    res.status(200).json({
      bookings,
      next_cursor,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve bookings' });
  }
});

// GET /bookings/:id (Level 1 · Get a booking)
router.get('/bookings/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const pool = getPool();

  try {
    const result = await pool.query(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve booking' });
  }
});

// DELETE /bookings/:id (Level 3 · Cancel a booking)
router.delete('/bookings/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await withTransaction<ApiResult>(async client => {
    const found = await client.query(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1',
      [id]
    );
    if (!found.rows.length) return { status: 404, body: { error: 'Booking not found' } };
    const booking = found.rows[0] as BookingRecord;
    if (booking.status === 'cancelled') {
      return { status: 409, body: { error: 'Already cancelled' } };
    }
    await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);
    booking.status = 'cancelled';
    return { status: 200, body: booking };
  });
  res.status(result.status).json(result.body);
});

export default router;
