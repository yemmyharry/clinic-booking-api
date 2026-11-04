import dotenv from 'dotenv';
import { createApp } from './app.js';
import { getPool, initSchema } from './db/index.js';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 3000;

async function bootstrap() {
  const pool = getPool();
  await initSchema(pool);

  app.listen(PORT, () => {
    console.log(`Clinic Booking API (PostgreSQL) listening on http://localhost:${PORT}`);
    console.log(`API Key required: ${process.env.API_KEY || 'koya-secret-key-123'}`);
    if (process.env.DATABASE_URL) {
      console.log(`Connected to PostgreSQL database.`);
    } else {
      console.log(`Running with in-memory PostgreSQL engine.`);
    }
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
