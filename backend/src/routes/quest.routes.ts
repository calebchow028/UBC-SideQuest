import { Router } from 'express';
import type { Services } from '../container.js';
import { requireUserId } from '../middleware/auth.middleware.js';
import { matchIdParamSchema } from '../schemas/api.schemas.js';

export function questRoutes(services: Services): Router {
  const router = Router();

  router.get('/quests/:matchId', (req, res) => {
    const { matchId } = matchIdParamSchema.parse(req.params);
    res.json(services.quests.getForUser(matchId, requireUserId(req)));
  });

  router.post('/quests/:matchId/complete', (req, res) => {
    const { matchId } = matchIdParamSchema.parse(req.params);
    res.json(services.quests.complete(matchId, requireUserId(req)));
  });

  return router;
}
