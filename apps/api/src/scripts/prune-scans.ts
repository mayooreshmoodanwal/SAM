import { pool } from '../db.js';
try {
  const result = await pool.query(
    "DELETE FROM scan_events WHERE created_at < now()-interval '30 days'",
  );
  console.log(`Removed ${result.rowCount} scan events older than 30 days.`);
} finally {
  await pool.end();
}
