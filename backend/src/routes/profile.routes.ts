import { Router } from 'express';
import type { Services } from '../container.js';
import { requireUserId } from '../middleware/auth.middleware.js';
import { profileInputSchema } from '../schemas/api.schemas.js';

export function profileRoutes(services: Services): Router {
  const router = Router();

  router.get('/profile', (req, res) => {
    res.json(services.profiles.get(requireUserId(req)));
  });

  router.put('/profile', (req, res) => {
    const input = profileInputSchema.parse(req.body);
    res.json(services.profiles.upsert(requireUserId(req), input));
  });

  return router;
}
