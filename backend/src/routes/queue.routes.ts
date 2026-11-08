import { Router } from 'express';
import type { Services } from '../container.js';
import { requireUserId } from '../middleware/auth.middleware.js';

export function queueRoutes(services: Services): Router {
  const router = Router();

  router.post('/queue/join', (req, res) => {
    res.json(services.matchmaking.join(requireUserId(req)));
  });

  router.post('/queue/leave', (req, res) => {
    res.json(services.matchmaking.leave(requireUserId(req)));
  });

  router.get('/queue/status', (req, res) => {
    res.json(services.matchmaking.status(requireUserId(req)));
  });

  return router;
}
