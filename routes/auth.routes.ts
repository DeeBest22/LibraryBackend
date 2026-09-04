// src/routes/auth.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.ts';
import { validate } from '../middleware/validate.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import * as ctrl from '../controllers/auth.controller.ts';

const platformTokenExchange = z.object({ platform_token: z.string().min(1) });
const adminLoginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

const router = Router();

router.get('/login', asyncHandler(ctrl.login));
router.get('/callback', asyncHandler(ctrl.callback));
router.post('/token/exchange', validate({ body: platformTokenExchange }), asyncHandler(ctrl.exchangePlatformToken));
router.post('/admin-login', validate({ body: adminLoginSchema }), asyncHandler(ctrl.adminLogin));
router.get('/me', authenticate, asyncHandler(ctrl.getCurrentUserInfo));
router.get('/logout', asyncHandler(ctrl.logout));

export default router;
// mount at /api/v1/auth