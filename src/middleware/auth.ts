import { Request, Response, NextFunction } from 'express';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKeyHeader = req.header('X-API-Key');
  const expectedKey = process.env.API_KEY || 'koya-secret-key-123';

  if (!apiKeyHeader || apiKeyHeader !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid X-API-Key header' });
    return;
  }

  next();
}
