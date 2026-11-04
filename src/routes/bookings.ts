import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getPool } from '../db/index.js';

const router = Router();

interface BookingRecord {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}

// POST /bookings (Levels 1–5)
router.post('/bookings', async (req: Request, res: Response) => {
  const pool = getPool();
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  // Level 4: Idempotency check
  const idempotencyKey = req.header('Idempotency-Key');
  const canonicalBody = JSON.stringify({
    slot_id: req.body?.slot_id,
    name: req.body?.name,
    email: req.body?.email,
  });

  if (idempotencyKey) {
    const cachedRes = await pool.query(
      'SELECT status_code, response_body, request_hash FROM idempotency_keys WHERE key = $1',
      [idempotencyKey]
    );

    if (cachedRes.rows.length > 0) {
      const cached = cachedRes.rows[0];
      if (cached.request_hash === canonicalBody) {
        res.status(cached.status_code).json(JSON.parse(cached.response_body));
        return;
      } else {
        res.status(422).json({ error: 'Idempotency-Key reused with a different body' });
        return;
      }
    }
  }

  // Level 5: Rate Limiting (per email, 5 attempts per minute, failed attempts included)
  if (rawEmail) {
    const now = Date.now();
    const windowStart = now - 60000;

    // Prune old entries
    await pool.query('DELETE FROM rate_limits WHERE timestamp < $1', [now - 300000]);

    const attemptsRes = await pool.query(
      'SELECT timestamp FROM rate_limits WHERE email = $1 AND timestamp > $2 ORDER BY timestamp ASC',
      [rawEmail, windowStart]
    );

    if (attemptsRes.rows.length >= 5) {
      const oldestInWindow = Number(attemptsRes.rows[0].timestamp);
      const waitMs = oldestInWindow + 60000 - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({ error: 'Too many attempts for this email' });
      return;
    }

    // Record this attempt immediately (failed attempts included)
    await pool.query('INSERT INTO rate_limits (email, timestamp) VALUES ($1, $2)', [rawEmail, now]);
  }

  // Level 2: Field presence and validation
  const { slot_id, name, email } = req.body || {};

  if (slot_id === undefined || slot_id === null || name === undefined || name === null || email === undefined || email === null) {
    res.status(400).json({ error: 'Missing required fields: slot_id, name, and email' });
    return;
  }

  const trimmedSlotId = String(slot_id).trim();
  const trimmedName = String(name).trim();
  const trimmedEmail = String(email).trim().toLowerCase();

  if (!trimmedSlotId || !trimmedName || !trimmedEmail) {
    res.status(400).json({ error: 'slot_id, name, and email cannot be empty' });
    return;
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  // Check slot exists
  const slotRes = await pool.query(
    'SELECT id, provider, start, slot_end FROM slots WHERE id = $1',
    [trimmedSlotId]
  );

  if (slotRes.rows.length === 0) {
    res.status(404).json({ error: 'Slot not found' });
    return;
  }

  const slot = slotRes.rows[0];

  // Check if slot has already started
  const slotStartTime = new Date(slot.start).getTime();
  if (slotStartTime <= Date.now()) {
    res.status(400).json({ error: 'The slot has already started' });
    return;
  }

  // Level 3: Check if already booked with confirmed status
  const existingConfirmedRes = await pool.query(
    "SELECT id FROM bookings WHERE slot_id = $1 AND status = 'confirmed'",
    [trimmedSlotId]
  );

  if (existingConfirmedRes.rows.length > 0) {
    res.status(409).json({ error: 'Slot already booked' });
    return;
  }

  // Create booking
  const bookingId = 'b_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const createdAt = new Date().toISOString();

  const newBooking: BookingRecord = {
    id: bookingId,
    slot_id: trimmedSlotId,
    name: trimmedName,
    email: trimmedEmail,
    status: 'confirmed',
    created_at: createdAt,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO bookings (id, slot_id, name, email, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [bookingId, trimmedSlotId, trimmedName, trimmedEmail, 'confirmed', createdAt]
    );

    if (idempotencyKey) {
      await client.query(
        'INSERT INTO idempotency_keys (key, request_hash, status_code, response_body, created_at) VALUES ($1, $2, $3, $4, $5)',
        [idempotencyKey, canonicalBody, 201, JSON.stringify(newBooking), Date.now()]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(newBooking);
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505' || (err.message && (err.message.includes('unique constraint') || err.message.includes('UNIQUE constraint')))) {
      res.status(409).json({ error: 'Slot already booked' });
      return;
    }
    res.status(500).json({ error: 'Internal server error while creating booking' });
  } finally {
    client.release();
  }
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
    const limitStr = String(limit);
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

  if (cursor && typeof cursor === 'string') {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [cursorCreatedAt, cursorId] = decoded.split('|');
      if (!cursorCreatedAt || !cursorId) {
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

    const booking = result.rows[0];

    if (booking.status === 'cancelled') {
      res.status(409).json({ error: 'Already cancelled' });
      return;
    }

    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);

    booking.status = 'cancelled';
    res.status(200).json(booking);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

export default router;
