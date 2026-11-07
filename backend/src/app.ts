import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import type { Services } from './container.js';
import type { AuthMiddleware } from './middleware/auth.middleware.js';
import { createErrorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { healthRoutes } from './routes/health.routes.js';
import { matchRoutes } from './routes/match.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { questRoutes } from './routes/quest.routes.js';
import { queueRoutes } from './routes/queue.routes.js';
import { type Logger, silentLogger } from './utils/logger.js';

export interface AppDeps {
  services: Services;
  /** Verifies the caller and sets `req.userId`. Chosen by the caller of createApp, never by a request. */
  auth: AuthMiddleware;
  corsOrigins?: string[];
  trustProxy?: boolean;
  logger?: Logger;
}

/**
 * Allowed origins are exact (`https://app.example.com`) or a single leading wildcard label
 * (`https://*.lovable.app`, matching any subdomain over https).
 */
export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return pattern === origin;
    const m = /^(https?):\/\/\*\.(.+)$/.exec(pattern);
    if (!m) return false;
    try {
      const url = new URL(origin);
      return url.protocol === `${m[1]}:` && url.host.endsWith(`.${m[2]}`);
    } catch {
      return false;
    }
  });
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  const logger = deps.logger ?? silentLogger;
  app.disable('x-powered-by');
  if (deps.trustProxy) app.set('trust proxy', 1);

  const allowed = deps.corsOrigins ?? [];
  const corsOptions: CorsOptions = {
    // Requests without an Origin (curl, server-to-server) are allowed; browsers must match the list.
    origin: (origin, cb) => cb(null, !origin || isOriginAllowed(origin, allowed)),
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  };
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '16kb' }));

  app.use(healthRoutes());

  const api = express.Router();
  api.use(deps.auth);
  api.use(profileRoutes(deps.services));
  api.use(queueRoutes(deps.services));
  api.use(questRoutes(deps.services));
  api.use(matchRoutes(deps.services));
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
