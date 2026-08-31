// src/controllers/user.controller.ts
import { Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.ts';
import { getUserProfile, updateUserProfile } from '../services/user.service.ts';

export async function getProfile(req: Request, res: Response): Promise<void> {
  const user = await getUserProfile(req.user!.id);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  res.status(200).json(user);
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const { name } = req.validated!.body as { name?: string };
  const user = await updateUserProfile(req.user!.id, name);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  res.status(200).json(user);
}