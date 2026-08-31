// routes/index.ts
import { Router } from 'express';
import authRoutes from './auth.routes.ts';
import libraryRoutes from './library.routes.ts';
import { booksEntityRouter, membersEntityRouter, borrowTransactionsEntityRouter } from './entities.routes.ts';
import aihubRoutes from './aihub.routes.ts';
import storageRoutes from './storage.routes.ts';
import settingsRoutes from './settings.routes.ts';
import userRoutes from './user.routes.ts';

const router = Router();
router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
router.use('/auth', authRoutes);
router.use('/library', libraryRoutes);
router.use('/entities/books', booksEntityRouter);
router.use('/entities/members', membersEntityRouter);
router.use('/entities/borrow_transactions', borrowTransactionsEntityRouter);
router.use('/aihub', aihubRoutes);
router.use('/storage', storageRoutes);
router.use('/settings', settingsRoutes);
router.use('/user', userRoutes);
export default router;