// src/routes/settings.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import { validate } from '../middleware/validate.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import * as ctrl from '../controllers/settings.controller.ts';

const envVariableUpdate = z.object({ value: z.string() });

const router = Router();
router.use(authenticate, requireAdmin);

router.get('', asyncHandler(ctrl.getSettings));
router.put('/backend/:key', validate({ body: envVariableUpdate }), asyncHandler(ctrl.updateBackendSetting));
router.post('/backend/:key', validate({ body: envVariableUpdate }), asyncHandler(ctrl.addBackendSetting));
router.delete('/backend/:key', asyncHandler(ctrl.deleteBackendSetting));
router.put('/frontend/:key', validate({ body: envVariableUpdate }), asyncHandler(ctrl.updateFrontendSetting));
router.post('/frontend/:key', validate({ body: envVariableUpdate }), asyncHandler(ctrl.addFrontendSetting));
router.delete('/frontend/:key', asyncHandler(ctrl.deleteFrontendSetting));

export default router;
// mount at /api/v1/admin/settings