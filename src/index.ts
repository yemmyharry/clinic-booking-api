import dotenv from 'dotenv';
import { createApp } from './app.js';
import { getPool, initSchema, closePool } from './db/index.js';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 3000;

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.API_KEY?.trim()) {
    throw new Error('API_KEY is required in production');
  }
  const pool = getPool();
  await initSchema(pool);

  const server = app.listen(PORT, () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : PORT;
    console.log(`Clinic Booking API (PostgreSQL) listening on http://localhost:${listeningPort}`);
    if (process.env.DATABASE_URL) {
      console.log(`Connected to PostgreSQL database.`);
    } else {
      console.log(`Running with in-memory PostgreSQL engine.`);
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    });
  }
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
