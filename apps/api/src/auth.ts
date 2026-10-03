import { Router } from 'express';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { pool, HttpError, audit, tx, one } from './db.js';
import { wrap, requireActor, requireAdmin, type AuthedRequest } from './http.js';
import { secureCookie } from './config.js';

export const authRouter = Router();
authRouter.get(
  '/setup-status',
  wrap(async (_req, res) => {
    const count = Number((await pool.query('SELECT count(*) count FROM users')).rows[0].count);
    res.json({ needsSetup: count === 0 });
  }),
);
authRouter.post(
  '/setup',
  wrap(async (req, res) => {
    const input = z
      .object({
        setupToken: z.string().min(1),
        adminName: z.string().min(2),
        adminEmail: z.string().email(),
        password: z.string().min(8),
        businessName: z.string().min(2),
        address: z.string(),
        phone: z.string(),
        gstin: z.string(),
        state: z.string(),
        invoicePrefix: z.string().regex(/^[A-Z0-9-]{1,12}$/),
        defaultGstBps: z.number().int().safe().min(0).max(10000),
      })
      .parse(req.body);
    if (!process.env.SETUP_TOKEN || input.setupToken !== process.env.SETUP_TOKEN)
      throw new HttpError(403, 'Invalid setup token.');
    const user = await tx(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(72419813)');
      const count = Number((await db.query('SELECT count(*) count FROM users')).rows[0].count);
      if (count) throw new HttpError(409, 'Setup has already been completed.');
      await db.query(
        `UPDATE business_settings SET name=$1,address=$2,phone=$3,gstin=$4,state=$5,
      invoice_prefix=$6,default_gst_bps=$7 WHERE id=1`,
        [
          input.businessName,
          input.address,
          input.phone,
          input.gstin,
          input.state,
          input.invoicePrefix,
          input.defaultGstBps,
        ],
      );
      const row = (
        await db.query(
          `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')
      RETURNING id,name,email,role`,
          [input.adminName, input.adminEmail.toLowerCase(), hashPassword(input.password)],
        )
      ).rows[0];
      await audit(db, row.id, 'SETUP', 'business', '1');
      return row;
    });
    res.status(201).json({ user });
  }),
);
const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
const scryptAsync = promisify(scrypt);
async function passwordMatches(password: string, stored: string) {
  const [algorithm, salt, hash] = stored.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash))
    return false;
  const a = Buffer.from(hash, 'hex');
  const b = (await scryptAsync(password, salt, a.length)) as Buffer;
  return a.length === b.length && timingSafeEqual(a, b);
}
const unknownPasswordHash = hashPassword(randomBytes(32).toString('hex'));
authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const input = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);
    const key = tokenDigest(`${req.ip || 'unknown'}:\0${input.email.toLowerCase()}`);
    const login = await tx(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [key]);
      await db.query('DELETE FROM auth_login_attempts WHERE reset_at<=now()');
      const attempt = (
        await db.query('SELECT failures FROM auth_login_attempts WHERE key_hash=$1', [key])
      ).rows[0];
      if (attempt && Number(attempt.failures) >= 5) return { status: 'blocked' as const };
      const { rows } = await db.query(
        'SELECT id,name,email,role,password_hash FROM users WHERE lower(email)=lower($1) AND active=true',
        [input.email],
      );
      const valid = await passwordMatches(
        input.password,
        rows[0]?.password_hash || unknownPasswordHash,
      );
      if (!rows[0] || !valid) {
        await db.query(
          `INSERT INTO auth_login_attempts(key_hash,failures,reset_at)
           VALUES($1,1,now()+interval '15 minutes')
           ON CONFLICT (key_hash) DO UPDATE SET failures=auth_login_attempts.failures+1`,
          [key],
        );
        return { status: 'invalid' as const };
      }
      await db.query('DELETE FROM auth_login_attempts WHERE key_hash=$1', [key]);
      await db.query('DELETE FROM sessions WHERE expires_at<=now()');
      const token = randomBytes(32).toString('hex');
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
        [tokenDigest(token), rows[0].id],
      );
      const { password_hash, ...actor } = rows[0];
      return { status: 'ok' as const, token, actor };
    });
    if (login.status === 'blocked')
      throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    if (login.status === 'invalid') throw new HttpError(401, 'Invalid email or password.');
    res.cookie('sam_session', login.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      path: '/',
      maxAge: 12 * 60 * 60 * 1000,
    });
    res.json({ user: login.actor });
  }),
);
authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const token = req.cookies?.sam_session;
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenDigest(token)]);
    res.clearCookie('sam_session', { path: '/' }).json({ ok: true });
  }),
);
authRouter.get(
  '/me',
  wrap(async (req, res) => {
    res.json({ user: requireActor(req) });
  }),
);
authRouter.post(
  '/change-password',
  wrap(async (req, res) => {
    const actor = requireActor(req);
    const input = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(12) })
      .parse(req.body);
    if (input.currentPassword === input.newPassword)
      throw new HttpError(400, 'Choose a different password.');
    await tx(async (db) => {
      const user = await one(db, 'SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [
        actor.id,
      ]);
      if (!(await passwordMatches(input.currentPassword, user.password_hash)))
        throw new HttpError(401, 'Current password is incorrect.');
      await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
        actor.id,
        hashPassword(input.newPassword),
      ]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [actor.id]);
      await audit(db, actor.id, 'PASSWORD_CHANGE', 'user', actor.id);
    });
    res.clearCookie('sam_session', { path: '/' }).json({ ok: true });
  }),
);
authRouter.get(
  '/users',
  wrap(async (req, res) => {
    requireAdmin(req);
    const { rows } = await pool.query(
      'SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at',
    );
    res.json(rows);
  }),
);
authRouter.post(
  '/users',
  wrap(async (req, res) => {
    const actor = requireAdmin(req);
    const input = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(12),
        role: z.enum(['ADMIN', 'EMPLOYEE']),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active',
      [input.name, input.email.toLowerCase(), hashPassword(input.password), input.role],
    );
    await audit(pool, actor.id, 'CREATE', 'user', rows[0].id, { role: input.role });
    res.status(201).json(rows[0]);
  }),
);
export async function attachActor(
  req: AuthedRequest,
  _res: unknown,
  next: (error?: unknown) => void,
) {
  try {
    const token = req.cookies?.sam_session;
    if (token) {
      const { rows } = await pool.query(
        `SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
        [tokenDigest(token)],
      );
      if (rows[0]) req.actor = rows[0];
    }
    next();
  } catch (error) {
    next(error);
  }
}
