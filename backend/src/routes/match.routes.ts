import { Router } from 'express';
import type { Services } from '../container.js';
import { requireUserId } from '../middleware/auth.middleware.js';
import { matchIdParamSchema } from '../schemas/api.schemas.js';

export function matchRoutes(services: Services): Router {
  const router = Router();

  router.post('/matches/:matchId/cancel', (req, res) => {
    const { matchId } = matchIdParamSchema.parse(req.params);
    res.json(services.matches.cancel(matchId, requireUserId(req)));
  });

  return router;
}
