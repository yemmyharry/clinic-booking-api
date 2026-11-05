import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { chromium } from 'playwright';

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to create an isolated browser-test database.');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const database = 'clinic_browser_' + crypto.randomBytes(8).toString('hex');
const key = 'browser-only-key-' + crypto.randomBytes(8).toString('hex');
let server, browser, db;
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  const databaseUrl = new URL(process.env.TEST_DATABASE_URL);
  databaseUrl.pathname = '/' + database;
  db = new pg.Client({ connectionString: databaseUrl.toString() });
  await db.connect();
  server = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', API_KEY: key, DATABASE_URL: databaseUrl.toString(), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server startup timed out: ' + output)), 15000);
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/listening on (http:\/\/localhost:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.stderr.on('data', chunk => { output += chunk; });
    server.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
  });
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const assertVisible = locator => locator.waitFor({ state: 'visible' });
  const waitCards = count => page.waitForFunction(count => document.querySelectorAll('.slot-card').length === count, count);
  const openBooking = async (email, name = 'Ada Patient') => {
    await page.locator('.btn-book-slot').first().click();
    await page.locator('#patientName').fill(name);
    await page.locator('#patientEmail').fill(email);
  };
  const confirmBooking = async () => {
    await page.locator('#submitBookingBtn').click();
    await assertVisible(page.locator('#confirmationBanner'));
    const id = await page.locator('#confBookingId').textContent();
    const stored = await api('/bookings/' + id);
    assert.equal(stored.status, 200);
    assert.equal(stored.data.status, 'confirmed');
    await page.waitForFunction(() => document.querySelectorAll('.badge-booked').length > 0);
    return stored.data;
  };
  const resetSchedule = async () => {
    assert.equal((await api('/reset', 'POST', { slots: [] })).status, 200);
    assert.equal((await api('/setup/demo', 'POST')).status, 201);
    await page.reload();
    await waitCards(12);
  };

  // A fresh deployment with a non-example key must provide an actionable setup flow.
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('connectionMessage').textContent.includes('API key'));
  await page.locator('#connectApiBtn').click();
  await page.locator('#apiKeyInput').fill('wrong-key');
  await page.locator('#saveKeyBtn').click();
  await page.waitForFunction(() => document.getElementById('keyFeedback').textContent.includes('rejected'));
  assert.equal(await page.locator('#keyModal').isVisible(), true);
  await page.locator('#apiKeyInput').fill(key);
  await page.locator('#saveKeyBtn').click();
  await assertVisible(page.locator('#setupScheduleBtn'));
  await page.locator('#setupScheduleBtn').click();
  await waitCards(12);
  assert.equal((await api('/slots')).data.slots.length, 12);
  console.log('PASS: fresh database, rejected key, valid connection, and real first-run appointments');

  await page.locator('#providerChipsContainer .chip').nth(1).click();
  await waitCards(4);
  assert.equal(await page.locator('#providerChipsContainer .chip').count(), 4);
  await page.getByRole('button', { name: 'All Doctors', exact: true }).click();
  await waitCards(12);
  await openBooking('invalid-email', 'Ada Patient');
  assert.equal(await page.locator('#patientEmail').evaluate(input => input.checkValidity()), false);
  await page.locator('#submitBookingBtn').click();
  assert.equal((await api('/bookings?email=patient@example.com')).data.bookings.length, 0);
  await page.locator('#patientEmail').fill('  PATIENT@EXAMPLE.COM  ');
  await page.locator('#patientName').fill('   ');
  await page.locator('#submitBookingBtn').click();
  await page.waitForFunction(() => document.getElementById('bookingFeedback').textContent.includes('Enter your name'));
  await page.locator('#patientName').fill('  Ada Patient  ');
  const booking = await confirmBooking();
  assert.equal(booking.name, 'Ada Patient');
  assert.equal(booking.email, 'patient@example.com');
  assert.equal((await api('/setup/demo', 'POST')).status, 409);
  assert.equal((await api('/bookings/' + booking.id)).data.status, 'confirmed');
  await page.reload();
  await page.locator('#tabBookingsBtn').click();
  await page.locator('#referenceInput').fill(booking.id);
  await page.locator('#referenceForm button').click();
  await assertVisible(page.locator('.booking-item-card'));
  assert.ok((await page.locator('#userBookingsList').textContent()).includes(booking.id));
  await page.locator('.cancel-item-btn').click();
  await assertVisible(page.locator('.status-badge-cancelled'));
  assert.equal((await api('/bookings/' + booking.id)).data.status, 'cancelled');
  assert.equal((await api('/slots')).data.slots.find(s => s.id === booking.slot_id).available, true);
  await page.locator('#referenceInput').fill('unknown-booking');
  await page.locator('#referenceForm button').click();
  await page.waitForFunction(() => document.getElementById('lookupFeedback').textContent.includes('No booking'));
  console.log('PASS: doctor filtering, actual booking, normalization, reload lookup, cancellation, and missing reference');

  await resetSchedule();
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.goto(base);
  await second.locator('.btn-book-slot').first().waitFor();
  await openBooking('race-one@example.com');
  await second.locator('.btn-book-slot').first().click();
  await second.locator('#patientName').fill('Second Patient');
  await second.locator('#patientEmail').fill('race-two@example.com');
  const slotId = await page.locator('#modalSlotId').inputValue();
  assert.equal(await second.locator('#modalSlotId').inputValue(), slotId);
  await Promise.all([page.locator('#submitBookingBtn').click(), second.locator('#submitBookingBtn').click()]);
  await Promise.all([page.waitForFunction(() => !document.getElementById('submitBookingBtn').disabled), second.waitForFunction(() => !document.getElementById('submitBookingBtn').disabled)]);
  const successful = Number(await page.locator('#confirmationBanner').isVisible()) + Number(await second.locator('#confirmationBanner').isVisible());
  assert.equal(successful, 1);
  const conflict = (await page.locator('#bookingFeedback').textContent()) + (await second.locator('#bookingFeedback').textContent());
  assert.ok(conflict.includes('Someone has just booked'));
  await second.close();
  console.log('PASS: two independent browser pages racing for one slot');

  await resetSchedule();
  await openBooking('network-retry@example.com');
  let dropped = false, originalKey;
  await page.route('**/bookings', async route => {
    if (route.request().method() === 'POST') {
      const requestKey = route.request().headers()['idempotency-key'];
      if (!dropped) {
        dropped = true;
        originalKey = requestKey;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort('failed');
        return;
      }
      assert.equal(requestKey, originalKey);
    }
    await route.continue();
  });
  await page.locator('#submitBookingBtn').click();
  await page.waitForFunction(() => document.getElementById('bookingFeedback').textContent.includes('safely retry'));
  await confirmBooking();
  assert.equal((await api('/bookings?email=network-retry@example.com')).data.bookings.length, 1);
  await page.unroute('**/bookings');
  console.log('PASS: a lost successful response safely retries with the same idempotency key');

  await resetSchedule();
  for (let i = 0; i < 5; i++) {
    await openBooking('pages@example.com');
    await confirmBooking();
    await page.locator('#closeConfBtn').click();
    await page.waitForFunction(count => document.querySelectorAll('.badge-booked').length === count, i + 1);
  }
  // Keep the real rolling window; move its five attempt timestamps near expiry.
  await db.query('UPDATE rate_limits SET timestamp = $1 WHERE email = $2', [Date.now() - 57000, 'pages@example.com']);
  await openBooking('pages@example.com');
  const rateResponse = page.waitForResponse(response => response.url() === base + '/bookings' && response.status() === 429);
  await page.locator('#submitBookingBtn').click();
  const response = await rateResponse;
  assert.match(response.headers()['retry-after'], /^\d+$/);
  await page.waitForFunction(() => document.getElementById('submitBookingBtn').textContent.includes('Try again in'));
  assert.equal(await page.locator('#submitBookingBtn').isDisabled(), true);
  await page.locator('#patientEmail').fill('unaffected@example.com');
  assert.equal(await page.locator('#submitBookingBtn').isDisabled(), false);
  await page.locator('#patientEmail').fill('pages@example.com');
  await page.waitForFunction(() => !document.getElementById('submitBookingBtn').disabled);
  await page.locator('#cancelModalBtn').click();
  await page.locator('#tabBookingsBtn').click();
  await page.locator('#lookupEmail').fill('PAGES@EXAMPLE.COM');
  await page.locator('#pageSize').selectOption('2');
  await page.locator('#searchBookingsBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('.booking-item-card').length === 2);
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('.booking-item-card').length === 4);
  await page.locator('#loadMoreBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('.booking-item-card').length === 5);
  assert.equal(await page.locator('#paginationControls').isVisible(), false);
  assert.equal(new Set(await page.locator('.booking-meta-id').allTextContents()).size, 5);
  console.log('PASS: five attempts, real 429/countdown, other-email isolation, expiry, and cursor pagination');

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
    const bounds = el.getBoundingClientRect();
    return bounds.width > 0 && (bounds.right > innerWidth + 1 || bounds.left < -1);
  }).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).slice(0, 20));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, JSON.stringify(overflow));
  await page.locator('#tabSlotsBtn').click();
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout and no browser JavaScript errors');
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  await db?.end();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
