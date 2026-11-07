import 'dotenv/config';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createServices } from './container.js';
import { openDatabase } from './database/db.js';
import { createAuth0Middleware, createDevAuthMiddleware } from './middleware/auth.middleware.js';
import { createLogger } from './utils/logger.js';

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(config.logLevel);
  const db = openDatabase(config.databasePath);
  const services = createServices({
    db,
    logger,
    matchRelaxAfterSeconds: config.matchRelaxAfterSeconds,
    maritime: config.maritime,
    n8n: config.n8n,
  });

  let auth;
  if (config.auth.mode === 'dev') {
    logger.warn('AUTH_MODE=dev: accepting "Bearer dev:<name>" tokens WITHOUT verification. Local development only.');
    auth = createDevAuthMiddleware();
  } else {
    auth = createAuth0Middleware({ issuerBaseURL: config.auth.issuerBaseURL, audience: config.auth.audience });
  }

  const app = createApp({ services, auth, corsOrigins: config.corsOrigins, trustProxy: config.trustProxy, logger });

  // Recover work interrupted by a previous shutdown, then keep retrying the n8n outbox.
  services.quests.resumePending();
  services.notifier.kick();
  const outboxTimer = setInterval(() => services.notifier.kick(), config.n8n.pollIntervalMs);
  outboxTimer.unref();

  const server = app.listen(config.port, config.host, () => {
    logger.info('sidequest-backend listening', {
      url: `http://${config.host}:${config.port}`,
      env: config.nodeEnv,
      auth: config.auth.mode,
      maritime: config.maritime.url ? 'configured' : 'not configured (fallback quests)',
      n8n: config.n8n.webhookUrl ? 'configured' : 'not configured (events disabled)',
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    clearInterval(outboxTimer);
    server.close(() => {
      // Give in-flight AI calls / webhooks a moment, then close the DB.
      const deadline = new Promise((r) => setTimeout(r, 5_000).unref());
      void Promise.race([services.whenIdle(), deadline]).finally(() => {
        db.close();
        process.exit(0);
      });
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
