// src/middleware/auth.middleware.ts
// Analog of dependencies/auth.py's get_current_user / get_admin_user (not yet sent).
// Verifies the app-issued Bearer JWT and attaches the decoded user to req.user.
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './error-handler.ts';
import { env } from '../config/env.ts';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Missing or invalid Authorization header'));
    return;
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET_KEY, {
      algorithms: [env.JWT_ALGORITHM as jwt.Algorithm],
    }) as jwt.JwtPayload;
    req.user = {
      id: String(payload.sub),
      email: payload.email as string,
      name: payload.name as string | undefined,
      role: payload.role as string,
    };
    next();
  } catch {
    next(new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token'));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    next(new AppError(403, 'FORBIDDEN', 'Admin privileges required'));
    return;
  }
  next();
}