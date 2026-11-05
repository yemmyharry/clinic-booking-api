import pg from 'pg';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a PostgreSQL connection with permission to create a disposable test database.');
  process.exit(1);
}
const database = 'clinic_test_' + crypto.randomBytes(8).toString('hex');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + database;
  const files = (await readdir('tests')).filter(name => name.endsWith('.test.ts')).sort().map(name => 'tests/' + name);
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url.toString(), RUN_POSTGRES_TESTS: '1' },
  });
  const code = await new Promise(resolve => {
    child.on('error', err => { console.error(err.message); resolve(1); });
    child.on('exit', code => resolve(code ?? 1));
  });
  process.exitCode = code;
} finally {
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
