// src/routes/entities.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts'; // added — Python source had NO auth here, see flag
import { asyncHandler } from '../utils/async-handler.ts';
import { makeCrudController } from '../controllers/generic-crud.controller.ts';
import { db } from '../config/prisma.ts';

function buildEntityRouter(delegate: any, entityName: string): Router {
  const ctrl = makeCrudController(delegate, entityName);
  const router = Router();
  router.use(authenticate);

  router.get('', asyncHandler(ctrl.getList));
  router.get('/all', asyncHandler(ctrl.getList)); // Python's "/all" variant is byte-identical logic to "" — no separate auth tier existed to differentiate them
  router.get('/:id', asyncHandler(ctrl.getById));
  router.post('', asyncHandler(ctrl.create));
  router.post('/batch', asyncHandler(ctrl.createBatch));
  router.put('/batch', asyncHandler(ctrl.updateBatch));
  router.put('/:id', asyncHandler(ctrl.update));
  router.delete('/batch', asyncHandler(ctrl.deleteBatch));
  router.delete('/:id', asyncHandler(ctrl.deleteOne));

  return router;
}

export const booksEntityRouter = buildEntityRouter(db.book, 'Book');
export const membersEntityRouter = buildEntityRouter(db.member, 'Member');
export const borrowTransactionsEntityRouter = buildEntityRouter(db.borrowTransaction, 'BorrowTransaction');

// mount at /api/v1/entities/books, /api/v1/entities/members, /api/v1/entities/borrow_transactions respectively