import dotenv from 'dotenv';
import { createApp } from './app.js';
import { getDatabase } from './db/index.js';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 3000;

// Initialize database
getDatabase();

app.listen(PORT, () => {
  console.log(`Clinic Booking API listening on http://localhost:${PORT}`);
  console.log(`API Key required: ${process.env.API_KEY || 'koya-secret-key-123'}`);
});
