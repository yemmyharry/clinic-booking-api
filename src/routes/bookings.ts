import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDatabase } from '../db/index.js';

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
router.post('/bookings', (req: Request, res: Response) => {
  const db = getDatabase();
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  // Level 4: Idempotency check
  // Identical replay returns the exact cached response without side effects
  const idempotencyKey = req.header('Idempotency-Key');
  const canonicalBody = JSON.stringify({
    slot_id: req.body?.slot_id,
    name: req.body?.name,
    email: req.body?.email,
  });

  if (idempotencyKey) {
    const cached = db
      .prepare('SELECT status_code, response_body, request_hash FROM idempotency_keys WHERE key = ?')
      .get(idempotencyKey) as { status_code: number; response_body: string; request_hash: string } | undefined;

    if (cached) {
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

    // Prune entries older than 5 minutes to keep table clean
    db.prepare('DELETE FROM rate_limits WHERE timestamp < ?').run(now - 300000);

    const attempts = db
      .prepare('SELECT timestamp FROM rate_limits WHERE email = ? AND timestamp > ? ORDER BY timestamp ASC')
      .all(rawEmail, windowStart) as { timestamp: number }[];

    if (attempts.length >= 5) {
      const oldestInWindow = attempts[0].timestamp;
      const waitMs = oldestInWindow + 60000 - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({ error: 'Too many attempts for this email' });
      return;
    }

    // Record this attempt immediately (failed attempts included)
    db.prepare('INSERT INTO rate_limits (email, timestamp) VALUES (?, ?)').run(rawEmail, now);
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
  const slot = db.prepare('SELECT id, provider, start, end FROM slots WHERE id = ?').get(trimmedSlotId) as
    | { id: string; provider: string; start: string; end: string }
    | undefined;

  if (!slot) {
    res.status(404).json({ error: 'Slot not found' });
    return;
  }

  // Check if slot has already started
  const slotStartTime = new Date(slot.start).getTime();
  if (slotStartTime <= Date.now()) {
    res.status(400).json({ error: 'The slot has already started' });
    return;
  }

  // Level 3: Check if already booked with confirmed status
  const existingConfirmed = db
    .prepare("SELECT id FROM bookings WHERE slot_id = ? AND status = 'confirmed'")
    .get(trimmedSlotId);

  if (existingConfirmed) {
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

  try {
    const bookTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO bookings (id, slot_id, name, email, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(bookingId, trimmedSlotId, trimmedName, trimmedEmail, 'confirmed', createdAt);

      if (idempotencyKey) {
        db.prepare(`
          INSERT INTO idempotency_keys (key, request_hash, status_code, response_body, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(idempotencyKey, canonicalBody, 201, JSON.stringify(newBooking), Date.now());
      }
    });

    bookTransaction();
    res.status(201).json(newBooking);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Slot already booked' });
      return;
    }
    res.status(500).json({ error: 'Internal server error while creating booking' });
  }
});

// GET /bookings (Level 4 · List a person's bookings)
router.get('/bookings', (req: Request, res: Response) => {
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

  const db = getDatabase();

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
        WHERE LOWER(email) = LOWER(?)
          AND (created_at > ? OR (created_at = ? AND id > ?))
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `;
      params = [normalizedEmail, cursorCreatedAt, cursorCreatedAt, cursorId, pageLimit + 1];
    } catch {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
  } else {
    query = `
      SELECT id, slot_id, name, email, status, created_at
      FROM bookings
      WHERE LOWER(email) = LOWER(?)
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `;
    params = [normalizedEmail, pageLimit + 1];
  }

  const rows = db.prepare(query).all(...params) as BookingRecord[];

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
});

// GET /bookings/:id (Level 1 · Get a booking)
router.get('/bookings/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();

  const booking = db
    .prepare('SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?')
    .get(id) as BookingRecord | undefined;

  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  res.status(200).json(booking);
});

// DELETE /bookings/:id (Level 3 · Cancel a booking)
router.delete('/bookings/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const db = getDatabase();

  const booking = db
    .prepare('SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = ?')
    .get(id) as BookingRecord | undefined;

  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  if (booking.status === 'cancelled') {
    res.status(409).json({ error: 'Already cancelled' });
    return;
  }

  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);

  booking.status = 'cancelled';
  res.status(200).json(booking);
});

export default router;
