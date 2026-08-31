// src/middleware/request-summary.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { currentRequest, runWithRequestState } from '../telemetry/timing.ts';
import { startRequest, finishRequest } from '../telemetry/request-summary.ts';

export function requestSummaryMiddleware(req: Request, res: Response, next: NextFunction): void {
  let state = currentRequest();
  let owner = null;

  if (!state) {
    try {
      owner = startRequest({
        method: req.method || 'UNKNOWN',
        path: req.path || '/',
        route: req.path || '/',
        headers: req.headers,
      });
    } catch {
      owner = null;
    }
    state = owner;
  }

  let errorType: string | null = null;

  const finish = (): void => {
    if (state) {
      try {
        const matchedRoute = req.route?.path;
        if (matchedRoute) {
          state.httpRoute = String(matchedRoute).slice(0, 512);
        } else if (res.statusCode >= 300 && res.statusCode < 400) {
          state.httpRoute = '__redirect__';
        } else {
          state.httpRoute = '__unmatched__';
        }
        state.urlPath = String(req.path || state.urlPath).slice(0, 2048);
        state.statusCode = res.statusCode;
        state.errorType = errorType;
      } catch {
        /* fail-open */
      }
    }
    if (owner) {
      finishRequest(owner, { statusCode: res.statusCode, errorType });
    }
  };

  res.on('finish', finish);
  res.on('close', () => {
    if (!res.writableEnded) finish();
  });

  const runNext = (): void => {
    try {
      next();
    } catch (err) {
      errorType = (err as Error)?.constructor?.name ?? 'Error';
      throw err;
    }
  };

  if (owner) {
    runWithRequestState(state!, runNext);
  } else {
    runNext();
  }
}