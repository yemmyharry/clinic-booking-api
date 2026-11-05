import { Router, Request, Response } from 'express';
import { withTransaction } from '../db/index.js';

const router = Router();
const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

router.post('/reset', async (req: Request, res: Response) => {
  const { slots } = req.body ?? {};
  if (!Array.isArray(slots)) {
    res.status(400).json({ error: 'Invalid payload: slots must be an array' });
    return;
  }

  const ids = new Set<string>();
  for (const slot of slots) {
    if (!slot || ['id', 'provider', 'start', 'end'].some(key => typeof slot[key] !== 'string' || !slot[key].trim())) {
      res.status(400).json({ error: 'Each slot requires non-empty string id, provider, start, and end fields' });
      return;
    }
    if (ids.has(slot.id)) {
      res.status(400).json({ error: 'Slot ids must be unique' });
      return;
    }
    ids.add(slot.id);
    if (![slot.start, slot.end].every(value => isoDateTime.test(value) && Number.isFinite(Date.parse(value))) || Date.parse(slot.end) <= Date.parse(slot.start)) {
      res.status(400).json({ error: 'Slots require valid ISO date-times with end after start' });
      return;
    }
  }

  await withTransaction(async client => {
    await client.query('DELETE FROM bookings');
    await client.query('DELETE FROM idempotency_keys');
    await client.query('DELETE FROM rate_limits');
    await client.query('DELETE FROM slots');
    for (const slot of slots) {
      await client.query('INSERT INTO slots (id, provider, start, slot_end) VALUES ($1, $2, $3, $4)', [slot.id, slot.provider, slot.start, slot.end]);
    }
  });
  res.status(200).json({ message: 'Done' });
});

export default router;
