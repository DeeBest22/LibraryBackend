// src/app.ts
import express from 'express';
import type { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rootRouter from './routes/index.ts';
import { requestSummaryMiddleware } from './middleware/request-summary.middleware.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { notFoundHandler } from './middleware/not-found.ts';

export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestSummaryMiddleware);

  app.use('/api/v1', rootRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}