import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 4 : 15,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 15_000,
});
if (process.env.VERCEL) attachDatabasePool(pool);
pool.on('error', (error) => console.error('Idle database connection failed:', error));
export type DB = Pick<PoolClient, 'query'>;
export async function tx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function one(db: DB, sql: string, params: unknown[] = []) {
  const result = await db.query(sql, params);
  if (!result.rows[0]) throw new HttpError(404, 'Record not found.');
  return result.rows[0];
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function audit(
  db: DB,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: object = {},
) {
  await db.query(
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [actorId, action, entityType, entityId, JSON.stringify(details)],
  );
}
export function num(value: unknown): number {
  return Number(value);
}
