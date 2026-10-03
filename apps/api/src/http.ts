import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { HttpError } from './db.js';
import { ZodError } from 'zod';
import { ValidationError } from './validation.js';

export type Actor = { id: string; name: string; email: string; role: 'ADMIN' | 'EMPLOYEE' };
export type AuthedRequest = Request & { actor: Actor };
export function wrap(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
export function requireActor(req: Request): Actor {
  const actor = (req as AuthedRequest).actor;
  if (!actor) throw new HttpError(401, 'Please sign in.');
  return actor;
}
export function requireAdmin(req: Request): Actor {
  const actor = requireActor(req);
  if (actor.role !== 'ADMIN') throw new HttpError(403, 'This action requires an administrator.');
  return actor;
}
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError)
    return res
      .status(400)
      .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
  const e = error as { code?: string; message?: string };
  if (e.code === '23505')
    return res.status(409).json({ error: 'A record with this unique value already exists.' });
  if (e.code === '23503')
    return res.status(409).json({ error: 'This record is linked to another record.' });
  if (['22P02', '22007', '22008', '23502', '23514'].includes(e.code || ''))
    return res.status(400).json({ error: 'A supplied value is invalid.' });
  if (e.message?.includes('Insufficient available stock'))
    return res
      .status(409)
      .json({ error: 'Insufficient available stock. Please review the current quantity.' });
  console.error(error);
  return res.status(500).json({
    error: 'The request could not be completed. Please retry or contact the administrator.',
  });
}
