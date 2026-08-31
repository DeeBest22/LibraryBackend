// src/routes/user.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts';
import { validate } from '../middleware/validate.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { updateProfileSchema } from '../schemas/user.schemas.ts';
import * as ctrl from '../controllers/user.controller.ts';

const router = Router();
router.use(authenticate);

router.get('/profile', asyncHandler(ctrl.getProfile));
router.put('/profile', validate({ body: updateProfileSchema }), asyncHandler(ctrl.updateProfile));

export default router;
// mount at /api/v1/user