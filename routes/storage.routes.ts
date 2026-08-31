// src/routes/storage.routes.ts
import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/async-handler.js';
import * as ctrl from '../controllers/storage.controller.js';
// Zod schemas for BucketRequest/ObjectRequest/RenameRequest/FileUpDownRequest
// depend on schemas/storage.py, not yet sent — validate() calls added once that lands.

const router = Router();
router.use(authenticate);

router.post('/create-bucket', requireAdmin, asyncHandler(ctrl.createBucket));
router.get('/list-buckets', asyncHandler(ctrl.listBuckets));
router.get('/list-objects', asyncHandler(ctrl.listObjects));
router.get('/get-object-info', asyncHandler(ctrl.getObjectInfo));
router.post('/rename-object', asyncHandler(ctrl.renameObject));
router.delete('/delete-object', asyncHandler(ctrl.deleteObject));
router.post('/upload-url', asyncHandler(ctrl.uploadUrl));
router.post('/download-url', asyncHandler(ctrl.downloadUrl));

export default router;
// mount at /api/v1/storage