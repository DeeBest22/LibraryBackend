// src/routes/auth.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import * as ctrl from '../controllers/auth.controller.js';

const platformTokenExchange = z.object({ platform_token: z.string().min(1) });

const router = Router();

router.get('/login', asyncHandler(ctrl.login));
router.get('/callback', asyncHandler(ctrl.callback));
router.post('/token/exchange', validate({ body: platformTokenExchange }), asyncHandler(ctrl.exchangePlatformToken));
router.get('/me', authenticate, asyncHandler(ctrl.getCurrentUserInfo));
router.get('/logout', asyncHandler(ctrl.logout));

export default router;
// mount at /api/v1/auth