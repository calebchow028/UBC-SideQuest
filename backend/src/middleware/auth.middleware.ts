import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { AppError, unauthorized } from '../utils/errors.js';

/**
 * Every protected route uses exactly one `RequestHandler` that, on success, sets
 * `req.userId` to a verified identity. Which handler is used is decided in code
 * (server.ts / test factories), never by anything in the incoming request.
 */
export type AuthMiddleware = RequestHandler;

export type Auth0Options =
  | { issuerBaseURL: string; audience: string }
  /** Explicit issuer + JWKS endpoint (used by tests with a locally generated key pair). */
  | { issuer: string; jwksUri: string; audience: string };

/**
 * Validates an Auth0 access token (RS256 signature via the tenant JWKS, `iss`, `aud`, `exp`)
 * and uses the token's `sub` as the user id.
 */
export function createAuth0Middleware(options: Auth0Options): AuthMiddleware {
  const verify = auth({ ...options, tokenSigningAlg: 'RS256' });
  return (req: Request, res: Response, next: NextFunction) => {
    verify(req, res, (err?: unknown) => {
      if (err) return next(err);
      const sub = req.auth?.payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) return next(unauthorized('Token has no subject'));
      req.userId = sub;
      next();
    });
  };
}

const DEV_TOKEN = /^dev:([A-Za-z0-9_.@-]{1,64})$/;

/**
 * LOCAL DEVELOPMENT ONLY. Accepts `Authorization: Bearer dev:<name>` and authenticates as
 * `dev|<name>`. Config validation (config/env.ts) refuses to enable this unless
 * NODE_ENV=development, and the `dev|` prefix can never collide with a real Auth0 subject.
 */
export function createDevAuthMiddleware(): AuthMiddleware {
  return (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return next(unauthorized());
    const m = DEV_TOKEN.exec(token);
    if (!m) return next(unauthorized('Invalid dev token. Use "Bearer dev:<name>".'));
    req.userId = `dev|${m[1]}`;
    next();
  };
}

/** For handlers behind an auth middleware: returns the verified user id. */
export function requireUserId(req: Request): string {
  if (!req.userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  return req.userId;
}
