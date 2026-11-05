import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requireApiKey } from './middleware/auth.js';
import resetRouter from './routes/reset.js';
import slotsRouter from './routes/slots.js';
import bookingsRouter from './routes/bookings.js';
import { getPool } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ exposedHeaders: ['Retry-After'] }));

  // Resolve public assets directory
  const publicDir = fs.existsSync(path.resolve(__dirname, 'public'))
    ? path.resolve(__dirname, 'public')
    : fs.existsSync(path.resolve(__dirname, '../src/public'))
    ? path.resolve(__dirname, '../src/public')
    : path.resolve(process.cwd(), 'src/public');

  // Serve static UI assets from public directory
  app.use(express.static(publicDir));

  // Health check endpoint
  app.get('/health', async (req: Request, res: Response) => {
    try {
      await getPool().query('SELECT 1');
      res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ error: 'Database unavailable' });
    }
  });

  // API endpoints protected by X-API-Key (Level 2)
  app.use(requireApiKey);
  app.use(express.json({ limit: '100kb' }));
  app.use(resetRouter);
  app.use(slotsRouter);
  app.use(bookingsRouter);

  // 404 handler for unknown routes
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Global error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
