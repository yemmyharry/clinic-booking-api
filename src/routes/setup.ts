import { Router } from 'express';
import { withTransaction } from '../db/index.js';
import crypto from 'node:crypto';

const router = Router();

// Explicit first-run setup. Never reset, replace, or replenish evaluator slots.
router.post('/setup/demo', async (_req, res) => {
  const result = await withTransaction(async client => {
    const existing = await client.query('SELECT id FROM slots LIMIT 1');
    if (existing.rows.length) {
      return { status: 409, body: { error: 'The schedule already contains slots. Existing appointments were not changed.' } };
    }
    const providers = ['Dr Ade', 'Dr Amara Okafor', 'Dr Ibrahim Musa'];
    const slots = Array.from({ length: 12 }, (_, i) => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 1 + Math.floor(i / 4));
      start.setUTCHours(8 + i % 4, 0, 0, 0);
      return {
        id: 'demo_' + crypto.randomUUID(), provider: providers[i % providers.length],
        start: start.toISOString(), end: new Date(start.getTime() + 30 * 60000).toISOString(), available: true,
      };
    });
    for (const slot of slots) {
      await client.query('INSERT INTO slots (id, provider, start, slot_end) VALUES ($1, $2, $3, $4)', [slot.id, slot.provider, slot.start, slot.end]);
    }
    return { status: 201, body: { slots } };
  });
  res.status(result.status).json(result.body);
});

export default router;
