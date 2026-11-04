import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requireApiKey } from './middleware/auth.js';
import resetRouter from './routes/reset.js';
import slotsRouter from './routes/slots.js';
import bookingsRouter from './routes/bookings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Handle malformed JSON request bodies
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }
    next(err);
  });

  // Resolve public assets directory
  const publicDir = fs.existsSync(path.resolve(__dirname, 'public'))
    ? path.resolve(__dirname, 'public')
    : fs.existsSync(path.resolve(__dirname, '../src/public'))
    ? path.resolve(__dirname, '../src/public')
    : path.resolve(process.cwd(), 'src/public');

  // Serve static UI assets from public directory
  app.use(express.static(publicDir));

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // API endpoints protected by X-API-Key (Level 2)
  app.use(requireApiKey);
  app.use(resetRouter);
  app.use(slotsRouter);
  app.use(bookingsRouter);

  // 404 handler for unknown routes
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  // Global error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
