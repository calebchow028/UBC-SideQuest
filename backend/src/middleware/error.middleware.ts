import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { type Logger, describeError } from '../utils/logger.js';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = { error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}` } };
  res.status(404).json(body);
};

/** Has an HTTP status, like errors thrown by express-oauth2-jwt-bearer and body-parser. */
function httpStatusOf(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 600) return status;
  }
  return null;
}

/** Centralised error -> JSON mapping. Never leaks stack traces or internal messages for 5xx. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let status = 500;
    let body: ErrorBody;

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    } else if (httpStatusOf(err) === 401 || httpStatusOf(err) === 403) {
      // express-oauth2-jwt-bearer: missing/invalid/expired token, wrong issuer/audience, bad signature.
      status = httpStatusOf(err) as number;
      body = {
        error: {
          code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: status === 401 ? 'Missing or invalid access token' : 'Insufficient permissions',
        },
      };
    } else if (httpStatusOf(err) === 400 && (err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } };
    } else if (httpStatusOf(err) === 413) {
      status = 413;
      body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } };
    } else {
      body = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };
    }

    if (status >= 500) logger.error('unhandled error', { method: req.method, path: req.path, error: describeError(err) });
    res.status(status).json(body);
  };
}
