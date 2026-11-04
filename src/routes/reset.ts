import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

const router = Router();

interface SlotPayload {
  id: string;
  provider: string;
  start: string;
  end: string;
}

router.post('/reset', (req: Request, res: Response) => {
  const { slots } = req.body || {};

  if (!Array.isArray(slots)) {
    res.status(400).json({ error: 'Invalid payload: slots must be an array' });
    return;
  }

  const db = getDatabase();

  const resetTransaction = db.transaction((slotList: SlotPayload[]) => {
    // Delete all bookings, idempotency keys, rate limits, and slots
    db.prepare('DELETE FROM bookings').run();
    db.prepare('DELETE FROM idempotency_keys').run();
    db.prepare('DELETE FROM rate_limits').run();
    db.prepare('DELETE FROM slots').run();

    const insertSlot = db.prepare(
      'INSERT INTO slots (id, provider, start, end) VALUES (?, ?, ?, ?)'
    );

    for (const slot of slotList) {
      if (!slot.id || !slot.provider || !slot.start || !slot.end) {
        throw new Error('Slot item missing required fields');
      }
      insertSlot.run(slot.id, slot.provider, slot.start, slot.end);
    }
  });

  try {
    resetTransaction(slots);
    res.status(200).json({ message: 'Done' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to reset slots' });
  }
});

export default router;
