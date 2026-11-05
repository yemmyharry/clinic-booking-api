import 'dotenv/config';

const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('Set API_KEY before creating demo slots.');
const providers = ['Dr Ade', 'Dr Amara Okafor', 'Dr Ibrahim Musa'];
const slots = Array.from({ length: 12 }, (_, i) => {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1 + Math.floor(i / 4));
  start.setUTCHours(8 + i % 4, 0, 0, 0);
  return { id: `demo-${i + 1}`, provider: providers[i % providers.length], start: start.toISOString(), end: new Date(start.getTime() + 30 * 60000).toISOString() };
});
// Reset is destructive, so seeding requires an explicit flag and is never run on startup.
if (!process.argv.includes('--reset')) {
  console.log('This replaces all slots and deletes bookings. Run npm run seed:demo -- --reset to proceed.');
  process.exit(1);
}
const response = await fetch(baseUrl + '/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: JSON.stringify({ slots }) });
if (!response.ok) throw new Error(`Seeding failed (${response.status}): ${await response.text()}`);
console.log(`Created ${slots.length} future demo slots at ${baseUrl}.`);
