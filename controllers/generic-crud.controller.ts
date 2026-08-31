// src/controllers/generic-crud.controller.ts
// Generic CRUD analog of the {entity}s scaffold — one factory instead of three
// near-duplicate files. Pass the Prisma delegate (e.g. db.book) per entity.
import { Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.ts';
import { parseQueryFilter, parseSort } from '../utils/query-parser.ts';

// Minimal structural type covering the Prisma model methods this factory needs.
interface CrudDelegate<T> {
  findMany(args: unknown): Promise<T[]>;
  count(args: unknown): Promise<number>;
  findUnique(args: unknown): Promise<T | null>;
  create(args: unknown): Promise<T>;
  update(args: unknown): Promise<T>;
  delete(args: unknown): Promise<T>;
}

export function makeCrudController<T>(delegate: CrudDelegate<T>, entityName: string) {
  async function getList(req: Request, res: Response): Promise<void> {
    const { query, sort, skip = '0', limit = '20' } = req.query as Record<string, string | undefined>;

    let queryDict: Record<string, unknown> | null = null;
    if (query) {
      try {
        queryDict = JSON.parse(query);
      } catch {
        throw new AppError(400, 'BAD_REQUEST', 'Invalid query JSON format');
      }
    }

    const where = parseQueryFilter(queryDict);
    const orderBy = parseSort(sort);
    const skipNum = Number(skip);
    const limitNum = Math.min(Math.max(Number(limit), 1), 2000);

    const [items, total] = await Promise.all([
      delegate.findMany({ where, orderBy, skip: skipNum, take: limitNum }),
      delegate.count({ where }),
    ]);

    res.status(200).json({ items, total, skip: skipNum, limit: limitNum });
  }

  async function getById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const result = await delegate.findUnique({ where: { id } });
    if (!result) throw new AppError(404, 'NOT_FOUND', `${entityName} not found`);
    res.status(200).json(result);
  }

  async function create(req: Request, res: Response): Promise<void> {
    const result = await delegate.create({ data: req.body });
    res.status(201).json(result);
  }

  async function createBatch(req: Request, res: Response): Promise<void> {
    const items = req.body.items as Record<string, unknown>[];
    const results: T[] = [];
    for (const itemData of items) {
      results.push(await delegate.create({ data: itemData }));
    }
    res.status(201).json(results);
  }

  async function update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const updateDict = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined && v !== null));
    try {
      const result = await delegate.update({ where: { id }, data: updateDict });
      res.status(200).json(result);
    } catch {
      throw new AppError(404, 'NOT_FOUND', `${entityName} not found`);
    }
  }

  async function updateBatch(req: Request, res: Response): Promise<void> {
    const items = req.body.items as { id: number; updates: Record<string, unknown> }[];
    const results: T[] = [];
    for (const item of items) {
      const updateDict = Object.fromEntries(Object.entries(item.updates).filter(([, v]) => v !== undefined && v !== null));
      try {
        results.push(await delegate.update({ where: { id: item.id }, data: updateDict }));
      } catch {
        /* skip missing rows, matching the Python "if result:" guard */
      }
    }
    res.status(200).json(results);
  }

  async function deleteOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    try {
      await delegate.delete({ where: { id } });
      res.status(200).json({ message: `${entityName} deleted successfully`, id });
    } catch {
      throw new AppError(404, 'NOT_FOUND', `${entityName} not found for deletion`);
    }
  }

  async function deleteBatch(req: Request, res: Response): Promise<void> {
    const ids = req.body.ids as number[];
    let deletedCount = 0;
    for (const id of ids) {
      try {
        await delegate.delete({ where: { id } });
        deletedCount += 1;
      } catch {
        /* skip missing rows */
      }
    }
    res.status(200).json({ message: `Successfully deleted ${deletedCount} ${entityName.toLowerCase()}(s)`, deleted_count: deletedCount });
  }

  return { getList, getById, create, createBatch, update, updateBatch, deleteOne, deleteBatch };
}