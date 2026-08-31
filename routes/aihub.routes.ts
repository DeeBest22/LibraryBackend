// src/routes/aihub.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import * as ctrl from '../controllers/aihub.controller.ts';
// Zod request schemas depend on schemas/aihub.py — not yet sent, validate() to be added then.

const router = Router();
router.use(authenticate);

router.post('/gentxt', asyncHandler(ctrl.generateText));
router.post('/genimg', asyncHandler(ctrl.generateImage));
router.post('/genvideo', asyncHandler(ctrl.generateVideo));
router.post('/genaudio', asyncHandler(ctrl.generateAudio));
router.post('/transcribe', asyncHandler(ctrl.transcribeAudio));
router.post('/analyzepdf', asyncHandler(ctrl.analyzePdf));

export default router;
// mount at /api/v1/aihub