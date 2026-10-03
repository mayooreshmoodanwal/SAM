import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required.');
const databaseHost = new URL(connectionString).hostname;
if (databaseHost.includes('-pooler.'))
  throw new Error('Migrations require a direct connection; set DATABASE_URL_UNPOOLED.');

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000 });
const dir = join(fileURLToPath(new URL('../../migrations/', import.meta.url)));
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(72419814)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const applied = (await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]))
      .rows.length;
    if (applied) continue;
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(dir, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await client.query('COMMIT');
      console.log('Applied', name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(72419814)');
  client.release();
  await pool.end();
}
