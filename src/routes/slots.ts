import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index.js';

const router = Router();

interface SlotRow {
  id: string;
  provider: string;
  start: string;
  end: string;
  confirmed_count: number;
}

router.get('/slots', (req: Request, res: Response) => {
  const { provider } = req.query;
  const db = getDatabase();

  let query = `
    SELECT 
      s.id, 
      s.provider, 
      s.start, 
      s.end,
      COUNT(b.id) AS confirmed_count
    FROM slots s
    LEFT JOIN bookings b ON s.id = b.slot_id AND b.status = 'confirmed'
  `;

  const params: any[] = [];

  if (typeof provider === 'string') {
    query += ' WHERE s.provider = ?';
    params.push(provider);
  }

  query += ' GROUP BY s.id ORDER BY s.start ASC';

  const rows = db.prepare(query).all(...params) as SlotRow[];

  const slots = rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    start: row.start,
    end: row.end,
    available: row.confirmed_count === 0,
  }));

  res.status(200).json({ slots });
});

export default router;
