// src/controllers/settings.controller.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { Request, Response } from 'express';
import { AppError } from '../middleware/error-handler.ts';

const BACKEND_ENV_PATH = path.resolve(process.cwd(), '.env');
const FRONTEND_ENV_PATH = path.resolve(process.cwd(), '..', 'frontend', '.env');

function envFilePath(envType: 'backend' | 'frontend'): string {
  return envType === 'backend' ? BACKEND_ENV_PATH : FRONTEND_ENV_PATH;
}

async function readEnvFile(envType: 'backend' | 'frontend'): Promise<Record<string, string>> {
  const filePath = envFilePath(envType);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return {};
  }
  const vars: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line && !line.startsWith('#') && line.includes('=')) {
      const [key, ...rest] = line.split('=');
      vars[key.trim()] = rest.join('=').trim();
    }
  }
  return vars;
}

async function writeEnvFile(envType: 'backend' | 'frontend', vars: Record<string, string>): Promise<void> {
  const filePath = envFilePath(envType);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf-8');
}

const BACKEND_DESCRIPTIONS: Record<string, string> = {
  DATABASE_URL: 'Database connection string',
  STRIPE_SECRET_KEY: 'Stripe secret key',
  STRIPE_SUCCESS_URL: 'Payment success callback URL',
  STRIPE_CANCEL_URL: 'Payment cancellation callback URL',
  ALLOWED_DOMAINS: 'Allowed domains',
  OIDC_ISSUER_URL: 'OIDC issuer URL',
  OIDC_CLIENT_ID: 'OIDC client ID',
  OIDC_CLIENT_SECRET: 'OIDC client secret',
  OIDC_SCOPE: 'OIDC scopes',
  HOST: 'Server host address',
  PORT: 'Server port',
  FRONTEND_URL: 'Frontend URL',
  JWT_SECRET_KEY: 'JWT signing secret key',
  JWT_ALGORITHM: 'JWT signing algorithm',
  JWT_EXPIRE_MINUTES: 'JWT expiration time (minutes)',
  ADMIN_USER_ID: 'Admin user ID',
  ADMIN_USER_EMAIL: 'Admin user email',
};
const FRONTEND_DESCRIPTIONS: Record<string, string> = {
  VITE_API_BASE_URL: 'Base API URL',
  VITE_FRONTEND_URL: 'Frontend URL',
};

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const backendVars = await readEnvFile('backend');
    const frontendVars = await readEnvFile('frontend');

    const toConfig = (vars: Record<string, string>, descriptions: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(vars).map(([key, value]) => [
          key,
          { key, value, description: descriptions[key] ?? '' },
        ]),
      );

    res.status(200).json({
      backend_vars: toConfig(backendVars, BACKEND_DESCRIPTIONS),
      frontend_vars: toConfig(frontendVars, FRONTEND_DESCRIPTIONS),
    });
  } catch (e) {
    throw new AppError(500, 'CONFIG_READ_FAILED', `Failed to read configuration: ${(e as Error).message}`);
  }
}

function upsertHandler(envType: 'backend' | 'frontend', verb: 'updated' | 'added') {
  return async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;
    const { value } = req.validated!.body as { value: string };
    try {
      const vars = await readEnvFile(envType);
      vars[key] = value;
      await writeEnvFile(envType, vars);
      res.status(200).json({
        message: `${envType[0].toUpperCase()}${envType.slice(1)} configuration '${key}' ${verb} successfully; restart required to take effect.`,
      });
    } catch (e) {
      throw new AppError(500, 'CONFIG_WRITE_FAILED', `Failed to ${verb === 'added' ? 'add' : 'update'} configuration: ${(e as Error).message}`);
    }
  };
}

export const updateBackendSetting = upsertHandler('backend', 'updated');
export const addBackendSetting = upsertHandler('backend', 'added');
export const updateFrontendSetting = upsertHandler('frontend', 'updated');
export const addFrontendSetting = upsertHandler('frontend', 'added');

function deleteHandler(envType: 'backend' | 'frontend') {
  return async (req: Request, res: Response): Promise<void> => {
    const { key } = req.params;
    try {
      const vars = await readEnvFile(envType);
      if (!(key in vars)) {
        throw new AppError(404, 'NOT_FOUND', `Configuration item '${key}' does not exist`);
      }
      delete vars[key];
      await writeEnvFile(envType, vars);
      res.status(200).json({
        message: `${envType[0].toUpperCase()}${envType.slice(1)} configuration '${key}' deleted successfully; restart required to take effect.`,
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(500, 'CONFIG_DELETE_FAILED', `Failed to delete configuration: ${(e as Error).message}`);
    }
  };
}

export const deleteBackendSetting = deleteHandler('backend');
export const deleteFrontendSetting = deleteHandler('frontend');