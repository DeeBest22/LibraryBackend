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

  // OIDC identity provider used for /api/v1/auth/login|callback. Required for
  // sign-in to work — without these, buildAuthorizationUrl()/validateIdToken()
  // silently operate on `undefined` and login will fail.
  OIDC_CLIENT_ID: z.string().default(''),
  OIDC_CLIENT_SECRET: z.string().default(''),
  OIDC_ISSUER_URL: z.string().default(''),
  OIDC_SCOPE: z.string().default('openid profile email'),

  // Optional: bootstraps a platform-level admin User row on startup.
  // (The library's own admin role is separately self-bootstrapped the first
  // time anyone signs in — see bootstrapAdminIfEmpty in library.service.ts.)
  ADMIN_USER_ID: z.string().default(''),
  ADMIN_USER_EMAIL: z.string().default(''),

  // Simple username/password login for the admin/librarian, bypassing OIDC.
  // CHANGE THESE in production — see /api/v1/auth/admin-login.
  ADMIN_LOGIN_USERNAME: z.string().default('admin'),
  ADMIN_LOGIN_PASSWORD: z.string().default('ChangeMe123!'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;