// src/controllers/storage.controller.ts
import { Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.ts';
import { StorageService } from '../services/storage.service.ts'; // pending: services/storage.py not yet sent

function handleServiceError(e: unknown): never {
  if (e instanceof Error && e.name === 'ValueError') {
    throw new AppError(400, 'BAD_REQUEST', e.message);
  }
  throw new AppError(500, 'STORAGE_ERROR', (e as Error).message);
}

export async function createBucket(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.createBucket(req.validated!.body));
  } catch (e) {
    handleServiceError(e);
  }
}

export async function listBuckets(_req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.listBuckets());
  } catch (e) {
    handleServiceError(e);
  }
}

export async function listObjects(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.listObjects(req.validated!.query));
  } catch (e) {
    handleServiceError(e);
  }
}

export async function getObjectInfo(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.getObjectInfo(req.validated!.query));
  } catch (e) {
    handleServiceError(e);
  }
}

export async function renameObject(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.renameObject(req.validated!.body));
  } catch (e) {
    handleServiceError(e);
  }
}

export async function deleteObject(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.deleteObject(req.validated!.body));
  } catch (e) {
    handleServiceError(e);
  }
}

export async function uploadUrl(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.createUploadUrl(req.validated!.body));
  } catch (e) {
    handleServiceError(e);
  }
}

export async function downloadUrl(req: Request, res: Response): Promise<void> {
  const service = new StorageService();
  try {
    res.status(200).json(await service.createDownloadUrl(req.validated!.body));
  } catch (e) {
    handleServiceError(e);
  }
}