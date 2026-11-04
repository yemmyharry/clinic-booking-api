import { Router, Request, Response } from 'express';
import { getPool } from '../db/index.js';

const router = Router();

interface SlotPayload {
  id: string;
  provider: string;
  start: string;
  end: string;
}

router.post('/reset', async (req: Request, res: Response) => {
  const { slots } = req.body || {};

  if (!Array.isArray(slots)) {
    res.status(400).json({ error: 'Invalid payload: slots must be an array' });
    return;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bookings');
    await client.query('DELETE FROM idempotency_keys');
    await client.query('DELETE FROM rate_limits');
    await client.query('DELETE FROM slots');

    for (const slot of slots as SlotPayload[]) {
      if (!slot.id || !slot.provider || !slot.start || !slot.end) {
        throw new Error('Slot item missing required fields');
      }
      await client.query(
        'INSERT INTO slots (id, provider, start, slot_end) VALUES ($1, $2, $3, $4)',
        [slot.id, slot.provider, slot.start, slot.end]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Done' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message || 'Failed to reset slots' });
  } finally {
    client.release();
  }
});

export default router;
