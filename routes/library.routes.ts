// src/routes/library.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts';
import { validate } from '../middleware/validate.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import * as ctrl from '../controllers/library.controller.ts';
import * as schemas from '../schemas/library.schemas.ts';

const router = Router();
router.use(authenticate);

router.get('/session', asyncHandler(ctrl.getSession));
router.post('/register', validate({ body: schemas.selfRegistrationSchema }), asyncHandler(ctrl.selfRegister));

router.get('/books', validate({ query: schemas.bookQuerySchema }), asyncHandler(ctrl.getBooks));
router.post('/admin/books', validate({ body: schemas.bookPayloadSchema }), asyncHandler(ctrl.adminCreateBook));
router.put('/admin/books/:bookId', validate({ body: schemas.bookPayloadSchema }), asyncHandler(ctrl.adminUpdateBook));
router.delete('/admin/books/:bookId', asyncHandler(ctrl.adminDeleteBook));

router.get('/admin/members', validate({ query: schemas.adminMembersQuerySchema }), asyncHandler(ctrl.adminListMembers));
router.post('/admin/members', validate({ body: schemas.memberPayloadSchema }), asyncHandler(ctrl.adminCreateMember));
router.put('/admin/members/:memberId', validate({ body: schemas.memberUpdateSchema }), asyncHandler(ctrl.adminUpdateMember));
router.delete('/admin/members/:memberId', asyncHandler(ctrl.adminDeleteMember));

router.post('/borrow', validate({ body: schemas.borrowRequestSchema }), asyncHandler(ctrl.borrow));
router.post('/return', validate({ body: schemas.returnRequestSchema }), asyncHandler(ctrl.recordReturn));
router.get('/my-transactions', asyncHandler(ctrl.myTransactions));
router.get('/admin/transactions', validate({ query: schemas.adminTransactionsQuerySchema }), asyncHandler(ctrl.adminTransactions));

router.get('/admin/reports', asyncHandler(ctrl.adminReports));

export default router;
// mount at /api/v1/library