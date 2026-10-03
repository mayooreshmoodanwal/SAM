import app from './server.js';
import { pool } from './db.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => console.log(`Shanti API listening on ${host}:${port}`));
function shutdown() {
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
