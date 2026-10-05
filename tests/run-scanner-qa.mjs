import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import assert from 'node:assert/strict';
const root = resolve('.');
mkdirSync('.local/scanner-qa', { recursive: true });
const dir = mkdtempSync(join(root, '.local/scanner-test-')),
  password = randomBytes(24).toString('hex');
const pwfile = join(dir, 'password');
writeFileSync(pwfile, password, { mode: 0o600 });
const data = join(dir, 'data'),
  log = join(root, '.local/scanner-qa/services.log');
const port = Number(process.env.SCANNER_TEST_PG_PORT || 5435),
  apiPort = Number(process.env.SCANNER_TEST_API_PORT || 3012),
  webPort = Number(process.env.SCANNER_TEST_WEB_PORT || 8181);
const databaseUrl = `postgres://samtest:${password}@127.0.0.1:${port}/postgres`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DATABASE_URL_UNPOOLED: databaseUrl,
  NODE_ENV: 'development',
  APP_ORIGIN: `http://localhost:${webPort}`,
  COOKIE_SECURE: 'false',
  HOST: '127.0.0.1',
  PORT: String(apiPort),
  API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  SEED_ADMIN_PASSWORD: password,
  TEST_ADMIN_PASSWORD: password,
  TEST_API_URL: `http://127.0.0.1:${apiPort}/api`,
  TEST_WEB_URL: `http://localhost:${webPort}`,
  SEED_ADMIN_EMAIL: 'admin@shantiauto.local',
};
let api,
  web,
  db,
  started = false;
const fd = openSync(log, 'w');
const run = (file, args, opts = {}) =>
  execFileSync(file, args, { cwd: root, env, stdio: 'inherit', ...opts });
try {
  run(
    'initdb',
    [
      '-D',
      data,
      '-U',
      'samtest',
      '--auth-local=scram-sha-256',
      '--auth-host=scram-sha-256',
      '--pwfile=' + pwfile,
    ],
    { stdio: 'ignore' },
  );
  rmSync(pwfile);
  run(
    'pg_ctl',
    [
      '-D',
      data,
      '-l',
      join(dir, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port} -k ${dir}`,
      'start',
    ],
    { stdio: 'ignore' },
  );
  started = true;
  db = new Pool({ connectionString: databaseUrl });
  await db.query(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of readdirSync('apps/api/migrations')
    .filter((n) => n.endsWith('.sql') && n < '010')
    .sort()) {
    await db.query(readFileSync('apps/api/migrations/' + name, 'utf8'));
    await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
  }
  await db.query(
    "INSERT INTO parts(name,sku,barcode,selling_price_paise,current_stock) VALUES('Legacy clean','LEGACY-CLEAN','000012345',100,5),('Legacy conflict A','LEGACY-A','001234',100,0),('Legacy conflict B','LEGACY-B',' 001234 ',100,0)",
  );
  run(process.execPath, ['apps/api/dist/scripts/migrate.js']);
  assert.equal(
    (await db.query("SELECT barcode FROM parts WHERE sku='LEGACY-B'")).rows[0].barcode,
    ' 001234 ',
  );
  run(process.execPath, ['apps/api/dist/scripts/seed.js']);
  api = spawn(process.execPath, ['apps/api/dist/start.js'], {
    cwd: root,
    env,
    stdio: ['ignore', fd, fd],
  });
  web = spawn(
    process.execPath,
    [
      join(
        dirname(createRequire(join(root, 'apps/web/package.json')).resolve('vite/package.json')),
        'bin/vite.js',
      ),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    { cwd: join(root, 'apps/web'), env, stdio: ['ignore', fd, fd] },
  );
  // Resolve Vite from the root dependency tree without relying on workspace hoisting.
  web.on('error', () => {});
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(env.TEST_API_URL + '/health')).ok && (await fetch(env.TEST_WEB_URL)).ok)
        break;
    } catch {}
    if (i === 59)
      throw new Error('Test services did not start; inspect .local/scanner-qa/services.log');
    await new Promise((r) => setTimeout(r, 300));
  }
  run(process.execPath, ['tests/integration.mjs']);
  run(process.execPath, ['tests/scanner-integration.mjs']);
  run(process.execPath, ['tests/scanner-browser.mjs']);
  console.log('All scanner QA passed on a disposable database.');
} finally {
  for (const child of [web, api]) if (child && !child.killed) child.kill('SIGTERM');
  await db?.end();
  if (started)
    try {
      execFileSync('pg_ctl', ['-D', data, '-m', 'fast', 'stop'], { stdio: 'ignore' });
    } catch {}
  closeSync(fd);
  rmSync(dir, { recursive: true, force: true });
}
