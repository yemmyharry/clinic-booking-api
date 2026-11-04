import { Router, Request, Response } from 'express';
import { getPool } from '../db/index.js';

const router = Router();

interface SlotRow {
  id: string;
  provider: string;
  start: string;
  slot_end: string;
  confirmed_count: number;
}

router.get('/slots', async (req: Request, res: Response) => {
  const { provider } = req.query;
  const pool = getPool();

  let query = `
    SELECT 
      s.id, 
      s.provider, 
      s.start, 
      s.slot_end,
      CAST(COUNT(b.id) AS integer) AS confirmed_count
    FROM slots s
    LEFT JOIN bookings b ON s.id = b.slot_id AND b.status = 'confirmed'
  `;

  const params: any[] = [];

  if (typeof provider === 'string') {
    query += ' WHERE s.provider = $1';
    params.push(provider);
  }

  query += ' GROUP BY s.id, s.provider, s.start, s.slot_end ORDER BY s.start ASC';

  try {
    const result = await pool.query(query, params);
    const rows = result.rows as SlotRow[];

    const slots = rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      start: row.start,
      end: row.slot_end,
      available: Number(row.confirmed_count) === 0,
    }));

    res.status(200).json({ slots });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve slots' });
  }
});

export default router;
