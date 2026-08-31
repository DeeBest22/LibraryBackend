// src/config/env.ts — PLACEHOLDER, full config.py port still pending
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET_KEY: z.string().min(1),
  JWT_ALGORITHM: z.string().default('HS256'),
  JWT_EXPIRE_MINUTES: z.coerce.number().default(60),
  FRONTEND_URL: z.string().default('http://127.0.0.1:3000'),
  BACKEND_URL: z.string().default('http://127.0.0.1:8000'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;