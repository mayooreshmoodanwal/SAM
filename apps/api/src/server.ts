import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { authRouter, attachActor } from './auth.js';
import { errorHandler, requireActor, wrap } from './http.js';
import { catalogRouter } from './catalog.js';
import { peopleRouter } from './people.js';
import { purchaseRouter } from './purchases.js';
import { billingRouter } from './billing.js';
import { operationsRouter } from './operations.js';
import { appOrigin } from './config.js';

const app = express();
app.disable('x-powered-by');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((helmet as any)({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const origin = req.headers.origin;
    if ((origin && origin !== appOrigin) || (!origin && req.headers['x-sam-request'] !== '1')) {
      res.status(403).json({ error: 'Request origin could not be verified.' });
      return;
    }
  }
  next();
});
app.use(attachActor as any);
app.get(
  '/api/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  }),
);
app.use('/api/auth', authRouter);
app.use('/api', (req, _res, next) => {
  try {
    requireActor(req);
    next();
  } catch (error) {
    next(error);
  }
});
app.use('/api', catalogRouter, peopleRouter, purchaseRouter, billingRouter, operationsRouter);
app.use(errorHandler);
export default app;
